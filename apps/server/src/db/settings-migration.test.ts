import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db, type Tx } from "./index.js";

/**
 * The statements the settings fold-in migration copies the old stores with,
 * read from the migration file itself so the test exercises exactly what
 * shipped, retargeted at temporary tables: the stores they read from are
 * dropped by the migration after it, and the tables they write to are live.
 * The targets are copies of the real tables, keys and defaults included.
 */
const migration = await Bun.file(
  new URL(
    "./migrations/20260926213759_settings-fold-in/migration.sql",
    import.meta.url
  )
).text();

const RETARGETED = {
  users: "fold_in_users",
  user_settings: "fold_in_user_settings",
  instance_settings: "fold_in_instance_settings",
  instance_setting_values: "fold_in_instance_setting_values",
};

const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes("INSERT INTO"))
  .map((statement) =>
    Object.entries(RETARGETED).reduce(
      (retargeted, [table, sample]) =>
        retargeted.replaceAll(`"${table}"`, `"${sample}"`),
      statement
    )
  );

/**
 * Runs the migration's statements over the rows `seed` writes, inside one
 * transaction whose temporary tables go with it, and hands back what landed.
 */
async function foldIn(seed: (tx: Tx) => Promise<void>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TEMP TABLE fold_in_users (id text PRIMARY KEY, prefs jsonb NOT NULL DEFAULT '{}')
      ON COMMIT DROP
    `);
    await tx.execute(sql`
      CREATE TEMP TABLE fold_in_instance_settings (
        id integer PRIMARY KEY,
        registration text NOT NULL,
        updated_at timestamp NOT NULL,
        updated_by text
      ) ON COMMIT DROP
    `);
    await tx.execute(sql`
      CREATE TEMP TABLE fold_in_user_settings (LIKE user_settings INCLUDING ALL)
      ON COMMIT DROP
    `);
    await tx.execute(sql`
      CREATE TEMP TABLE fold_in_instance_setting_values (LIKE instance_setting_values INCLUDING ALL)
      ON COMMIT DROP
    `);
    await seed(tx);

    for (const statement of statements) await tx.execute(sql.raw(statement));

    const { rows: userRows } = await tx.execute<{
      user_id: string;
      key: string;
      value: unknown;
    }>(sql`
      SELECT user_id, key, value FROM fold_in_user_settings ORDER BY user_id, key
    `);
    const { rows: instanceRows } = await tx.execute<{
      key: string;
      value: unknown;
      locked: boolean;
      updated_by: string | null;
    }>(sql`
      SELECT key, value, locked, updated_by FROM fold_in_instance_setting_values
    `);
    return { userRows, instanceRows };
  });
}

describe("the settings fold-in migration", () => {
  it("has the statements it is tested by", () => {
    expect(statements).toHaveLength(3);
  });

  it("gives each prefix a user set a row of its own, and nothing else a row", async () => {
    const { userRows } = await foldIn(async (tx) => {
      await tx.execute(sql`
        INSERT INTO fold_in_users (id, prefs) VALUES
          ('both', '{"prefixes": {"rhyme": "/", "synonym": "@"}}'),
          ('rhyme-only', '{"prefixes": {"rhyme": "#"}}'),
          ('saved-rhyme', '{"prefixes": {"rhyme": "!", "synonym": "~"}}'),
          ('saved-defaults', '{"prefixes": {"rhyme": "\\\\", "synonym": "~"}}'),
          ('untouched', '{}'),
          ('not-strings', '{"prefixes": {"rhyme": 5, "synonym": null}}'),
          ('not-an-object', '{"prefixes": "~"}')
      `);
    });

    expect(userRows).toEqual([
      { user_id: "both", key: "editor.rhymePrefix", value: "/" },
      { user_id: "both", key: "editor.synonymPrefix", value: "@" },
      { user_id: "rhyme-only", key: "editor.rhymePrefix", value: "#" },
      // The old write stored the defaults beside the prefix a user saved.
      { user_id: "saved-rhyme", key: "editor.rhymePrefix", value: "!" },
    ]);
  });

  it("carries the registration mode into its row, with who set it", async () => {
    const { instanceRows } = await foldIn(async (tx) => {
      await tx.execute(sql`
        INSERT INTO fold_in_instance_settings (id, registration, updated_at, updated_by)
        VALUES (1, 'closed', now(), 'an-admin')
      `);
    });

    expect(instanceRows).toEqual([
      {
        key: "instance-access.registration",
        value: "closed",
        locked: false,
        updated_by: "an-admin",
      },
    ]);
  });

  it("writes no registration row for an instance that never had one", async () => {
    const { instanceRows } = await foldIn(async () => {});

    expect(instanceRows).toEqual([]);
  });
});
