/**
 * Restores a demo snapshot (`snapshot.ts`) into this workspace, so a
 * screenshot run starts from the seeded world without seeding it again. It
 * runs only from a linked worktree, never the main checkout:
 *
 *   bun run --cwd packages/demo restore -- [latest | <snapshot dir>] [--db <name>] \
 *     [--inputs ~/projammr-demo-audio] [--pg-container pj-dev-pg]
 *
 * 1. Checks each part against the manifest's checksum, and that the snapshot's
 *    schema is one this checkout can migrate forward from; otherwise it stops
 *    and says to reseed (`seed.ts`, then `snapshot.ts`).
 * 2. Drops and recreates the target database (`--db`, default the one the
 *    workspace's server env names; never the main checkout's) and restores the
 *    dump into it. Stop the workspace's API first: the drop ends its sessions.
 * 3. Moves every timestamp forward by the time since the snapshot was taken,
 *    so relative dates ("3 days ago") read as they did the day it was seeded.
 * 4. Runs the checkout's migrations newer than the snapshot. If one fails the
 *    database is left as it is and the restore says to reseed.
 * 5. Replaces the workspace server's static files with the snapshot's.
 * 6. Writes the snapshot's NOTES_MASTER_KEY and the database into the
 *    workspace's `apps/server/.env`, and its seed result to
 *    `<inputs>/seed-result.json` for the capture script. Start the API after.
 */
import { $, SQL } from "bun";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { restoreDatabase } from "./pg-tools";
import {
  assertInWorkspace,
  assertNotMainCheckout,
  assertNotOwnerDatabase,
  assertWorkspaceEnv,
  readServerEnv,
  repoMigrations,
  SERVER_DIR,
  sha256,
  snapshotsDir,
  WORKSPACE_STATIC,
} from "./snapshot-io";
import {
  databaseOf,
  migrationPlan,
  PARTS,
  parseManifest,
  runDatabaseRestore,
  setEnvValues,
  shiftTimestampsSql,
  type TimestampColumn,
  withDatabase,
  WORKSPACE_SERVER_ENV,
} from "./snapshot-lib";

await assertNotMainCheckout();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string" },
    inputs: { type: "string", default: join(homedir(), "projammr-demo-audio") },
    "server-env": { type: "string", default: WORKSPACE_SERVER_ENV },
    static: { type: "string", default: WORKSPACE_STATIC },
    "pg-container": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const RESEED =
  "Reseed instead: `seed.ts` against an empty database, then `snapshot.ts`.";

const envPath = await assertWorkspaceEnv(values["server-env"]);
const staticDir = await assertInWorkspace(values.static);

const which = positionals[0] ?? "latest";
const dir = await realpath(
  which.includes("/") ? which : join(snapshotsDir(values.inputs), which)
);
const manifest = parseManifest(
  await Bun.file(join(dir, "snapshot.json")).json()
);
for (const part of PARTS) {
  if ((await sha256(join(dir, part))) !== manifest.parts[part].sha256) {
    fail(
      `${part} in ${dir} does not match its checksum; the snapshot is damaged. ${RESEED}`
    );
  }
}

const plan = migrationPlan(manifest.migration, await repoMigrations());
if (plan.action === "reseed") fail(`${plan.reason}. ${RESEED}`);

const { text: envText, url: envUrl } = await readServerEnv(envPath);
const database = values.db ?? databaseOf(envUrl);
await assertNotOwnerDatabase(database);
const url = withDatabase(envUrl, database);

await runDatabaseRestore(plan, {
  async restoreDump() {
    console.log(`recreating ${database}`);
    const admin = new SQL({ url: withDatabase(envUrl, "postgres"), max: 1 });
    try {
      const quoted = `"${database.replaceAll('"', '""')}"`;
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${quoted}`);
    } finally {
      await admin.close();
    }
    await restoreDatabase(url, join(dir, "db.dump"), values["pg-container"]);
  },

  async shiftTimestamps() {
    const shiftMs = Math.max(0, Date.now() - Date.parse(manifest.createdAt));
    const sql = new SQL({ url, max: 1 });
    try {
      const columns = (await sql`
        select table_name as "table", column_name as "column"
        from information_schema.columns
        where table_schema = 'public'
          and data_type in ('timestamp without time zone', 'timestamp with time zone')
        order by table_name, ordinal_position`) as TimestampColumn[];
      await sql.begin(async (tx) => {
        for (const statement of shiftTimestampsSql(columns, shiftMs))
          await tx.unsafe(statement);
      });
      console.log(
        `moved ${columns.length} timestamp columns forward by ${(shiftMs / 3_600_000).toFixed(1)} h`
      );
    } finally {
      await sql.close();
    }
  },

  async migrate(pending) {
    console.log(`migrating forward: ${pending.join(", ")}`);
    const migrate = await $`bun run migrate`
      .cwd(SERVER_DIR)
      .env({ ...process.env, DATABASE_URL: url, MIGRATE_BACKUP: "0" })
      .nothrow();
    if (migrate.exitCode !== 0) {
      fail(
        `a migration failed on the restored database (see above); it has not been changed to fit. ${RESEED}`
      );
    }
  },
});

console.log(`replacing ${staticDir}`);
await mkdir(staticDir, { recursive: true });
for (const entry of await readdir(staticDir)) {
  await rm(join(staticDir, entry), { recursive: true, force: true });
}
await $`tar -xf ${join(dir, "media.tar")} -C ${staticDir}`;

await Bun.write(
  envPath,
  setEnvValues(envText, {
    DATABASE_URL: url,
    NOTES_MASTER_KEY: manifest.notesMasterKey,
  })
);
await Bun.write(
  join(values.inputs, "seed-result.json"),
  Bun.file(join(dir, "seed-result.json"))
);

console.log(`restored ${dir} into ${database}.`);
console.log(
  `${envPath} now carries the snapshot's NOTES_MASTER_KEY; start the API now.`
);
const [first] = Object.values(manifest.accounts);
if (first) console.log(`sign in as ${first.email} / ${first.password}`);
