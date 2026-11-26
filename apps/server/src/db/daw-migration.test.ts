import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "./index.js";

/**
 * The `UPDATE` statements the `daw` enum-to-text migration backfills with,
 * read from the migration file itself so the test exercises exactly what
 * shipped, retargeted at a throwaway table so it can run after the real
 * migration (and the `daw` enum it drops) is long gone.
 */
const migration = await Bun.file(
  new URL(
    "./migrations/20260918123636_sleepy_pet_avengers/migration.sql",
    import.meta.url
  )
).text();

const updateStatements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes("UPDATE "))
  .map((statement) =>
    statement.replaceAll('"sessions"', '"daw_migration_sample"')
  );

describe("the daw column's enum-to-text migration", () => {
  it("maps 'Ableton' to its module id, display name and full capability list, and every other value to a manual entry named after itself", async () => {
    expect(updateStatements.length).toBeGreaterThan(0);

    await db.execute(sql`
      CREATE TABLE daw_migration_sample (
        daw text,
        daw_name text,
        daw_capabilities text[] NOT NULL DEFAULT '{}'
      )
    `);
    try {
      await db.execute(sql`
        INSERT INTO daw_migration_sample (daw)
        VALUES ('Ableton'), ('Logic Pro'), ('Other')
      `);

      for (const statement of updateStatements) {
        await db.execute(sql.raw(statement));
      }

      const { rows } = await db.execute<{
        daw: string;
        daw_name: string;
        daw_capabilities: string[];
      }>(sql`
        SELECT daw, daw_name, daw_capabilities
        FROM daw_migration_sample
        ORDER BY daw_name
      `);
      const byOldName = Object.fromEntries(rows.map((r) => [r.daw_name, r]));

      expect(byOldName["Ableton Live"]).toEqual({
        daw: "ableton",
        daw_name: "Ableton Live",
        daw_capabilities: [
          "tempo",
          "key",
          "timeSignature",
          "dawVersion",
          "structure",
          "clips",
          "scenes",
          "plugins",
          "samplePaths",
          "renderHints",
          "backups",
        ],
      });

      expect(byOldName["Logic Pro"]).toEqual({
        daw: "manual",
        daw_name: "Logic Pro",
        daw_capabilities: [],
      });

      expect(byOldName["Other"]).toEqual({
        daw: "manual",
        daw_name: "Other",
        daw_capabilities: [],
      });
    } finally {
      await db.execute(sql`DROP TABLE daw_migration_sample`);
    }
  });
});
