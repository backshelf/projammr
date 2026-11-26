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
import { DEFAULT_RELATION_TYPES } from "./queries/track-relation-types.js";

/**
 * The migrations that turn the `relation_type` enum into per-project relation
 * types: the table and the nullable column, the backfill, then `NOT NULL`, the
 * unique index re-keyed and the enum dropped. Run here on a database of its own
 * the way they run on a live one: migrated to just before them, given
 * relations holding every enum value, then migrated the rest of the way.
 */
const TRIO = [
  "20260927013813_track-relation-types",
  "20260927013823_track-relation-types-backfill",
  "20260927014224_track-relation-types-required",
] as const;

const ENUM_VALUES = [
  "remix",
  "remaster",
  "rework",
  "edit",
  "live version",
  "cover",
  "instrumental",
  "acoustic",
] as const;

const guard = await migrationGuard(TRIO[1]);

/** A project with its priority scale's default, which every track needs. */
async function seedProject(pool: Pool, name: string): Promise<number> {
  const {
    rows: [project],
  } = await pool.query<{ id: number }>(
    "insert into projects (name) values ($1) returning id",
    [name]
  );
  await pool.query(
    "insert into priority_levels (project_id, name, colour, rank, is_default) values ($1, 'None', '#525252', 0, true)",
    [project!.id]
  );
  return project!.id;
}

async function seedTrack(
  pool: Pool,
  projectId: number,
  title: string
): Promise<number> {
  const {
    rows: [track],
  } = await pool.query<{ id: number }>(
    `insert into tracks (title, artists, project_id, priority_id)
     select $1, '[]', $2, id from priority_levels where project_id = $2
     returning id`,
    [title, projectId]
  );
  return track!.id;
}

async function seedRelation(
  pool: Pool,
  from: number,
  to: number,
  value: string
): Promise<number> {
  const {
    rows: [relation],
  } = await pool.query<{ id: number }>(
    "insert into track_relations (from_track_id, to_track_id, relation) values ($1, $2, $3) returning id",
    [from, to, value]
  );
  return relation!.id;
}

describe("the relation enum-to-types migrations", () => {
  it("give every project the eight types in order and every relation, an archived track's included, its from-track's type of the same name", async () => {
    expect(guard).toBeDefined();

    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, TRIO[0]);

      // The value each relation held, to check its type against once the
      // column is gone.
      const held = new Map<number, string>();
      const projects: number[] = [];
      const firstTracks: number[] = [];
      for (const name of ["First", "Second"]) {
        const projectId = await seedProject(pool, name);
        projects.push(projectId);
        const source = await seedTrack(pool, projectId, `${name} source`);
        const derivative = await seedTrack(pool, projectId, `${name} version`);
        if (name === "First") firstTracks.push(source, derivative);
        for (const value of ENUM_VALUES) {
          held.set(await seedRelation(pool, derivative, source, value), value);
        }
        // Both directions between one pair, as a cycle the API allows.
        held.set(
          await seedRelation(pool, source, derivative, "remix"),
          "remix"
        );
      }
      // A relation reaching across projects, which the API refuses today but
      // older rows may hold: it takes its from-track's project's type.
      const {
        rows: [secondSource],
      } = await pool.query<{ id: number }>(
        "select id from tracks where project_id = $1 order by id limit 1",
        [projects[1]]
      );
      const crossing = await seedRelation(
        pool,
        firstTracks[1]!,
        secondSource!.id,
        "cover"
      );
      held.set(crossing, "cover");
      // An archived track keeps its relations, so they are carried too.
      const shelved = await seedTrack(pool, projects[1]!, "Second shelved");
      await pool.query("update tracks set archived_at = now() where id = $1", [
        shelved,
      ]);
      held.set(
        await seedRelation(pool, shelved, secondSource!.id, "acoustic"),
        "acoustic"
      );
      projects.push(await seedProject(pool, "Empty"));

      // With the column added but nothing backfilled, the guard refuses to
      // let the run carry on.
      await migrateUpTo(pool, TRIO[1]);
      await expect(pool.query(guard!)).rejects.toThrow(
        "relation type backfill left a track relation without a type"
      );

      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows: types } = await pool.query<{
        project_id: number;
        name: string;
        rank: number;
      }>(
        "select project_id, name, rank from track_relation_types order by project_id, rank"
      );
      for (const projectId of projects) {
        expect(
          types
            .filter((type) => type.project_id === projectId)
            .map(({ name, rank }) => ({ name, rank }))
        ).toEqual(DEFAULT_RELATION_TYPES.map((name, rank) => ({ name, rank })));
      }
      expect([...DEFAULT_RELATION_TYPES]).toEqual([...ENUM_VALUES]);

      const { rows: relations } = await pool.query<{
        id: number;
        type: string;
        type_project: number;
        from_project: number;
      }>(
        `select r.id, t.name as type, t.project_id as type_project,
                f.project_id as from_project
         from track_relations r
         join track_relation_types t on t.id = r.relation_type_id
         join tracks f on f.id = r.from_track_id`
      );
      expect(relations.length).toBe(held.size);
      for (const relation of relations) {
        expect(relation.type).toBe(held.get(relation.id)!);
        expect(relation.type_project).toBe(relation.from_project);
      }
      expect(
        relations.find((relation) => relation.id === crossing)?.type_project
      ).toBe(projects[0]!);

      const {
        rows: [column],
      } = await pool.query<{ is_nullable: string }>(
        "select is_nullable from information_schema.columns where table_name = 'track_relations' and column_name = 'relation_type_id'"
      );
      expect(column?.is_nullable).toBe("NO");
      const {
        rows: [index],
      } = await pool.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where indexname = 'track_relation_unique'"
      );
      expect(index?.indexdef).toContain(
        "(from_track_id, to_track_id, relation_type_id)"
      );
      await expect(
        pool.query("select enum_range(null::relation_type)")
      ).rejects.toThrow('type "relation_type" does not exist');
    }, "relation_types");
  }, 60_000);
});
