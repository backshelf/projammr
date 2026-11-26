import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { migrateUpTo, withThrowawayDatabase } from "../test/database.js";
import { MIGRATIONS_FOLDER } from "./migrator.js";

/**
 * The migration that turns `session_revisions` into `saves`: the table, its
 * enum and its indexes are renamed in place and the content columns added, so
 * every row a deployed instance already holds survives with its id. Run here
 * the way it runs on a live database: migrated to just before it, given rows
 * of every source, then migrated the rest of the way.
 */
const MIGRATION = "20261004004840_saves-content";

const SOURCES = ["scan", "backup", "app"] as const;

type SeededRow = { id: number; machine_name: string; meta: unknown };

async function seedRevisions(pool: Pool): Promise<SeededRow[]> {
  const {
    rows: [project],
  } = await pool.query<{ id: number }>(
    "insert into projects (name) values ('Saves') returning id"
  );
  const {
    rows: [level],
  } = await pool.query<{ id: number }>(
    "insert into priority_levels (project_id, name, colour, rank, is_default) values ($1, 'None', '#6C7278', 0, true) returning id",
    [project!.id]
  );
  const {
    rows: [session],
  } = await pool.query<{ id: number }>(
    "insert into sessions (name, daw, project_id, priority_id) values ('Demo', 'manual', $1, $2) returning id",
    [project!.id, level!.id]
  );
  const rows: SeededRow[] = [];
  for (const [index, source] of SOURCES.entries()) {
    const meta = { tempo: 100 + index, samplePaths: null };
    const {
      rows: [row],
    } = await pool.query<SeededRow>(
      `insert into session_revisions (session_id, project_id, file_updated_at, machine_name, source, meta)
       values ($1, $2, $3, $4, $5, $6) returning id, machine_name, meta`,
      [
        session!.id,
        project!.id,
        new Date(Date.UTC(2026, 8, 20 + index)),
        `machine ${source}`,
        source,
        JSON.stringify(meta),
      ]
    );
    rows.push(row!);
  }
  return rows;
}

describe("the session revisions to saves migration", () => {
  it("keeps every row with its id and meta, reading back as metadata only", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, MIGRATION);
      const seeded = await seedRevisions(pool);

      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows } = await pool.query<{
        id: number;
        machine_name: string;
        source: string;
        meta: unknown;
        hash: string | null;
        xml_hash: string | null;
        tree: string | null;
        side: string | null;
        view_only: boolean;
        unreadable: boolean;
        content_state: string;
      }>("select * from saves order by id");

      expect(rows.map((row) => row.id)).toEqual(seeded.map((row) => row.id));
      expect(rows.map((row) => row.source)).toEqual([...SOURCES]);
      expect(rows.map((row) => row.machine_name)).toEqual(
        seeded.map((row) => row.machine_name)
      );
      expect(rows.map((row) => row.meta)).toEqual(
        seeded.map((row) => row.meta)
      );
      for (const row of rows) {
        expect(row).toMatchObject({
          hash: null,
          xml_hash: null,
          tree: null,
          side: null,
          view_only: false,
          unreadable: false,
          content_state: "none",
        });
      }
    });
  }, 30_000);

  it("renames the table, enum and indexes rather than copying them", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, MIGRATION);
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows: tables } = await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('saves', 'session_revisions')"
      );
      expect(tables.map((table) => table.table_name)).toEqual(["saves"]);

      const { rows: types } = await pool.query<{
        typname: string;
        labels: string[];
      }>(
        `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.typname in ('save_source', 'revision_source', 'content_state')
         group by t.typname order by t.typname`
      );
      expect(types).toEqual([
        {
          typname: "content_state",
          labels: ["none", "stored", "pruned"],
        },
        { typname: "save_source", labels: ["scan", "backup", "app", "dit"] },
      ]);

      const { rows: indexes } = await pool.query<{ indexname: string }>(
        "select indexname from pg_indexes where tablename = 'saves' and indexname not like '%\\_pkey' order by indexname"
      );
      expect(indexes.map((index) => index.indexname)).toEqual([
        "save_branch",
        "save_machine",
        "save_project_time",
        "save_session_hash",
        "save_session_time",
      ]);
    });
  }, 30_000);

  it("accepts a dit save and holds a session's content hash to one save", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, MIGRATION);
      await seedRevisions(pool);
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const {
        rows: [existing],
      } = await pool.query<{ session_id: number; project_id: number }>(
        "select session_id, project_id from saves limit 1"
      );
      const insert = (day: number, hash: string | null) =>
        pool.query(
          "insert into saves (session_id, project_id, file_updated_at, source, hash) values ($1, $2, $3, 'dit', $4)",
          [
            existing!.session_id,
            existing!.project_id,
            new Date(Date.UTC(2026, 9, day)),
            hash,
          ]
        );

      await insert(1, "abc");
      await expect(insert(2, "abc")).rejects.toThrow(/save_session_hash/);
      // A save with no content carries no hash, and any number of them may.
      await insert(3, null);
      await insert(4, null);
    });
  }, 30_000);
});
