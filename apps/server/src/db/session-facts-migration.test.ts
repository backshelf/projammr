import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrateUpTo, withThrowawayDatabase } from "../test/database.js";
import { MIGRATIONS_FOLDER } from "./migrator.js";

/**
 * The migration that copies each session's newest save meta onto the session
 * once, run the way it runs on a live database: migrated to just before it,
 * given sessions whose facts are the scanner's last read, then migrated the
 * rest of the way.
 */
const MIGRATION = "20261022003438_session_facts_from_saves";

type SessionFacts = {
  name: string;
  tempo: string | null;
  time_signature: string | null;
  root_note: string | null;
  scale: string | null;
  tracks_count: number | null;
  scenes_count: number | null;
  daw_version: string | null;
  structure: unknown;
};

const structure = {
  tracks: [{ kind: "audio", name: "Lead", devices: ["Serum 2"] }],
  plugins: { "Serum 2": { host: "vst3" } },
};

describe("the session facts from saves migration", () => {
  it("takes the newest save's meta, and leaves a session whose newest save has none", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, MIGRATION);

      const {
        rows: [project],
      } = await pool.query<{ id: number }>(
        "insert into projects (name) values ('Facts') returning id"
      );
      const {
        rows: [level],
      } = await pool.query<{ id: number }>(
        "insert into priority_levels (project_id, name, colour, rank, is_default) values ($1, 'None', '#6C7278', 0, true) returning id",
        [project!.id]
      );
      const addSession = async (name: string, tempo: number) =>
        (
          await pool.query<{ id: number }>(
            "insert into sessions (name, daw, project_id, priority_id, tempo) values ($1, 'ableton', $2, $3, $4) returning id",
            [name, project!.id, level!.id, tempo]
          )
        ).rows[0]!.id;
      const addSave = (sessionId: number, day: number, meta: unknown | null) =>
        pool.query(
          `insert into saves (session_id, project_id, file_updated_at, source, meta)
           values ($1, $2, $3, 'scan', $4)`,
          [
            sessionId,
            project!.id,
            new Date(Date.UTC(2026, 8, day)),
            meta === null ? null : JSON.stringify(meta),
          ]
        );

      const followed = await addSession("followed", 90);
      await addSave(followed, 21, { tempo: "100", samplePaths: null });
      await addSave(followed, 22, {
        tempo: "120.5",
        timeSignature: "3/4",
        rootNote: "F#",
        scale: "Minor",
        tracksCount: 4,
        scenesCount: 2,
        dawVersion: "12.1",
        structure,
        samplePaths: null,
      });
      const stale = await addSession("stale", 90);
      await addSave(stale, 21, { tempo: "100", samplePaths: null });
      await addSave(stale, 22, null);
      await addSession("empty", 90);

      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows } = await pool.query<SessionFacts>(
        "select name, tempo, time_signature, root_note, scale, tracks_count, scenes_count, daw_version, structure from sessions order by name"
      );
      const byName = new Map(rows.map((row) => [row.name, row]));
      expect(byName.get("followed")).toEqual({
        name: "followed",
        tempo: "120.5",
        time_signature: "3/4",
        root_note: "F#",
        scale: "Minor",
        tracks_count: 4,
        scenes_count: 2,
        daw_version: "12.1",
        structure,
      });
      expect(byName.get("stale")?.tempo).toBe("90");
      expect(byName.get("empty")?.tempo).toBe("90");
    });
  }, 30_000);
});
