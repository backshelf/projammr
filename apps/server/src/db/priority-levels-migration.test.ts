import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  migrateUpTo,
  migrationGuard,
  withThrowawayDatabase,
} from "../test/database.js";
import { MIGRATIONS_FOLDER } from "./migrator.js";

/**
 * The migrations that turn the `priority` enum into per-project levels: the
 * table and its nullable columns, the backfill, then `NOT NULL` and the enum
 * dropped. Run here on a database of its own the way they run on a live one:
 * migrated to just before them, given rows holding every enum value, then
 * migrated the rest of the way.
 */
const TRIO = [
  "20260926204616_priority-levels",
  "20260926204628_priority-levels-backfill",
  "20260926204757_priority-levels-required",
] as const;

const ENUM_VALUES = ["none", "low", "medium", "high", "urgent"] as const;

/** The backfill's own guard, read from the file so the test runs what shipped. */
const guard = await migrationGuard(TRIO[1]);

/** A project with one track, collection and two sessions per enum value. */
async function seedEnumRows(pool: Pool, name: string): Promise<number> {
  const {
    rows: [project],
  } = await pool.query<{ id: number }>(
    "insert into projects (name) values ($1) returning id",
    [name]
  );
  const projectId = project!.id;
  for (const value of ENUM_VALUES) {
    const {
      rows: [track],
    } = await pool.query<{ id: number }>(
      "insert into tracks (title, artists, project_id, priority) values ($1, '[]', $2, $3) returning id",
      [`${name} ${value}`, projectId, value]
    );
    await pool.query(
      "insert into collections (title, project_id, priority) values ($1, $2, $3)",
      [`${name} ${value}`, projectId, value]
    );
    await pool.query(
      "insert into sessions (name, daw, project_id, track_id, priority) values ($1, 'manual', $2, $3, $4), ($5, 'manual', $2, null, $4)",
      [
        `${name} ${value}`,
        projectId,
        track!.id,
        value,
        `${name} ${value} loose`,
      ]
    );
  }
  return projectId;
}

describe("the priority enum-to-levels migrations", () => {
  it("give every project five levels and every row its own project's level of the same name", async () => {
    expect(guard).toBeDefined();

    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, TRIO[0]);
      const first = await seedEnumRows(pool, "First");
      const second = await seedEnumRows(pool, "Second");
      const {
        rows: [empty],
      } = await pool.query<{ id: number }>(
        "insert into projects (name) values ('Empty') returning id"
      );

      // With the column added but nothing backfilled, the guard refuses to
      // let the run carry on.
      await migrateUpTo(pool, TRIO[1]);
      await expect(pool.query(guard!)).rejects.toThrow(
        "priority backfill left a track, collection or session without a level"
      );

      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows: levels } = await pool.query<{
        project_id: number;
        name: string;
        colour: string;
        rank: number;
        is_default: boolean;
      }>(
        "select project_id, name, colour, rank, is_default from priority_levels order by project_id, rank"
      );
      // The backfill first paints every project in the old seed's greys;
      // migrating to the tip then carries every untouched level on to
      // `20260927223610_priority-levels-recolour`'s new ramp.
      const scale = [
        { name: "None", colour: "#6C7278", rank: 0, is_default: true },
        { name: "Low", colour: "#0891C9", rank: 1, is_default: false },
        { name: "Medium", colour: "#D6B529", rank: 2, is_default: false },
        { name: "High", colour: "#F06B00", rank: 3, is_default: false },
        { name: "Urgent", colour: "#D0183A", rank: 4, is_default: false },
      ];
      for (const projectId of [first, second, empty!.id]) {
        expect(
          levels
            .filter((level) => level.project_id === projectId)
            .map(({ name, colour, rank, is_default }) => ({
              name,
              colour,
              rank,
              is_default,
            }))
        ).toEqual(scale);
      }

      for (const [table, title, count] of [
        ["tracks", "title", 10],
        ["collections", "title", 10],
        ["sessions", "name", 20],
      ] as const) {
        const { rows } = await pool.query<{
          title: string;
          level: string;
          same_project: boolean;
        }>(
          `select x.${title} as title, l.name as level, l.project_id = x.project_id as same_project
           from ${table} x join priority_levels l on l.id = x.priority_id`
        );
        expect(rows.length).toBe(count);
        for (const row of rows) {
          const value = row.title.split(" ")[1]!;
          expect(row.level.toLowerCase()).toBe(value);
          expect(row.same_project).toBe(true);
        }
      }

      await expect(
        pool.query("select enum_range(null::priority)")
      ).rejects.toThrow('type "priority" does not exist');
    }, "priority_levels");
  }, 60_000);
});
