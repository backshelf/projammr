import { spawnSync } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { getMigrationsToRun } from "drizzle-orm/migrator.utils";
import type { Pool, PoolClient } from "pg";
import { log } from "../lib/log.js";
import { db } from "./index.js";

/**
 * Where drizzle-kit writes migrations, relative to the server's working
 * directory. `drizzle.config.ts` reads it from here so the generator and the
 * migrator can never disagree about the folder.
 */
export const MIGRATIONS_FOLDER = "./src/db/migrations";

/** Where a pre-migrate dump is written, relative to the server's working directory. */
const BACKUPS_DIR = "./backups";

/** How many pre-migrate dumps `dumpBeforeMigrate` keeps before pruning the oldest. */
const BACKUPS_KEPT = 5;

const logger = log("migrator");

/**
 * Arbitrary but fixed: `pg_advisory_lock` only needs every replica to agree
 * on the same key, and this is "MIGR" spelled out in hex — unlikely to
 * collide with a row-scoped lock class some other subsystem picks.
 */
const MIGRATION_LOCK = 0x4d494752;

/**
 * The migrations the journal names that `drizzle.__drizzle_migrations` has
 * not recorded yet, in the order drizzle itself applies them. Reads on the
 * same session {@link applyMigrations} holds the advisory lock on, so a
 * concurrent second run sees the truth once it gets the lock rather than a
 * snapshot from before the first run committed.
 *
 * The very first run against a fresh database has no `drizzle` schema yet;
 * that reads as an empty table rather than an error, drizzle's own `migrate`
 * creates the schema and the table as part of applying the first migration.
 */
type MigrationRow = {
  id: number;
  hash: string;
  created_at: string;
  name: string | null;
};

async function pendingMigrations(client: PoolClient): Promise<MigrationMeta[]> {
  const local = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const applied = await client
    .query<MigrationRow>(
      "select id, hash, created_at, name from drizzle.__drizzle_migrations"
    )
    .then((result) => result.rows)
    .catch((error: { code?: string }) => {
      if (error.code === "42P01") return []; // undefined_table
      throw error;
    });
  return getMigrationsToRun({ localMigrations: local, dbMigrations: applied });
}

/**
 * The connection the dump should make, spread across the environment variables
 * `pg_dump` reads instead of handed to it as an argument.
 *
 * A connection string in `argv` is legible to every local user through the
 * process table — `ps`, or `/proc/<pid>/cmdline`, which is world-readable —
 * and `DATABASE_URL` carries the password. A child's environment is readable
 * only by its own user. Same connection, one fewer place the password is
 * lying in the open for as long as the dump runs.
 */
function dumpEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");

  return {
    ...process.env,
    PGHOST: url.hostname,
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ...(url.port ? { PGPORT: url.port } : {}),
    ...(url.username ? { PGUSER: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

/**
 * Runs `pg_dump --format=custom` against the pool's own database into
 * {@link BACKUPS_DIR}, so a migration that turns out to be wrong has a
 * restore point newer than the last nightly backup. A developer machine has
 * no `pg_dump` on `PATH` and is not a deployment, so a missing binary only
 * warns and lets the migration proceed; a `pg_dump` that starts and exits
 * non-zero aborts the migration outright — a deployment does not get to
 * alter a schema it just failed to back up.
 */
async function dumpBeforeMigrate(pool: Pool, tag: string): Promise<void> {
  const target = pool.options.connectionString;
  if (!target) {
    throw new Error("the migration pool has no connection string to dump");
  }

  await mkdir(BACKUPS_DIR, { recursive: true });
  const file = join(BACKUPS_DIR, `pre-${tag}-${Date.now()}.dump`);

  const result = spawnSync("pg_dump", ["--format=custom", "--file", file], {
    stdio: ["ignore", "ignore", "pipe"],
    env: dumpEnvironment(target),
  });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn("pg_dump is not on PATH; skipping the pre-migrate backup");
      return;
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `pg_dump exited ${result.status}: ${result.stderr.toString().trim()}`
    );
  }

  await pruneBackups(BACKUPS_DIR);
}

/**
 * Keeps the newest {@link BACKUPS_KEPT} pre-migrate dumps in `dir`, oldest
 * out first. Exported so the retention rule has a test that does not need a
 * database or `pg_dump` — just files on disk.
 */
export async function pruneBackups(dir: string): Promise<void> {
  const entries = await readdir(dir);
  const dumps = entries.filter(
    (name) => name.startsWith("pre-") && name.endsWith(".dump")
  );
  if (dumps.length <= BACKUPS_KEPT) return;

  const withAge = await Promise.all(
    dumps.map(async (name) => ({
      name,
      mtime: (await stat(join(dir, name))).mtimeMs,
    }))
  );
  withAge.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(
    withAge.slice(BACKUPS_KEPT).map((old) => unlink(join(dir, old.name)))
  );
}

/**
 * Applies every migration in {@link MIGRATIONS_FOLDER} the database has not
 * yet recorded, in folder order. This is drizzle-orm's own migrator, run
 * under a session-level `pg_advisory_lock` so two replicas booting together
 * serialise instead of racing: the second waits here, then finds nothing
 * pending once the first has committed. `MIGRATE_BACKUP=0` skips the
 * pre-migrate dump; any other value (including unset) takes one whenever a
 * migration is actually about to run.
 *
 * `pool` defaults to the app's own connection pool; a test passes a pool
 * bound to a throwaway database instead, so it never touches the pool every
 * other suite shares.
 */
export async function applyMigrations(pool: Pool = db.$client): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);

    const pending = await pendingMigrations(client);
    if (pending.length === 0) return;

    if (process.env.MIGRATE_BACKUP !== "0") {
      await dumpBeforeMigrate(pool, pending[0]!.name);
    }

    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK])
      .catch(() => {});
    client.release();
  }
}
