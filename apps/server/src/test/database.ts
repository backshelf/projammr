import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { db } from "../db/index.js";
import { applyMigrations, MIGRATIONS_FOLDER } from "../db/migrator.js";
import { relations } from "../db/relations.js";
import { users } from "../db/schema/auth.js";

/**
 * An account written straight to the row, the way Better Auth's adapter
 * would, for a test on a database of its own.
 */
export async function mkUserRow(
  database: typeof db,
  overrides: {
    email?: string;
    isAnonymous?: boolean | null;
    instanceRole?: "admin" | "user";
    disabledAt?: Date | null;
  } = {}
): Promise<string> {
  const id = randomUUID();
  await database.insert(users).values({
    id,
    name: id.slice(0, 8),
    email: overrides.email ?? `${id}@example.com`,
    isAnonymous: overrides.isAnonymous ?? false,
    instanceRole: overrides.instanceRole ?? "user",
    disabledAt: overrides.disabledAt ?? null,
  });
  return id;
}

/**
 * A fresh database on the same server `DATABASE_URL` points at, so a test can
 * lock, dump and migrate without ever touching the database the rest of the
 * suite — and every sibling agent's suite — shares.
 */
export async function withThrowawayDatabase(
  fn: (pool: Pool) => Promise<void>,
  label = "throwaway"
): Promise<void> {
  const base = new URL(process.env.DATABASE_URL!);
  const name = `${label}_${randomUUID().replaceAll("-", "")}`;

  const admin = new Pool({ connectionString: base.href });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const target = new URL(base.href);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href });
  try {
    await fn(pool);
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: base.href });
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
}

/**
 * Applies every migration folder that sorts before `stop`, and no others: the
 * database as it stood just before `stop` ran, for a test that seeds the rows
 * a data migration has to carry across.
 */
export async function migrateUpTo(pool: Pool, stop: string): Promise<void> {
  const folders = (await readdir(MIGRATIONS_FOLDER, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < stop)
    .map((entry) => entry.name);
  const partial = await mkdtemp(join(tmpdir(), "partial-migrations-"));
  try {
    for (const folder of folders) {
      await cp(join(MIGRATIONS_FOLDER, folder), join(partial, folder), {
        recursive: true,
      });
    }
    await migrate(drizzle({ client: pool }), { migrationsFolder: partial });
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
}

/**
 * The `DO $$` guard a data migration ends on, read from its own file so a test
 * runs the statement that shipped.
 */
export async function migrationGuard(
  folder: string
): Promise<string | undefined> {
  const sql = await Bun.file(
    join(MIGRATIONS_FOLDER, folder, "migration.sql")
  ).text();
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .find((statement) => statement.includes("DO $$"));
}

/**
 * A migrated throwaway database as a drizzle instance, for the behaviour that
 * can only be observed on an instance the test owns outright — a first sign-up,
 * or an admin set of a known size. The query layer takes such an instance as an
 * argument wherever that is the case.
 *
 * The pre-migrate dump is skipped: there is nothing in a database created one
 * statement ago to back up, and `pg_dump` is not always installed.
 */
export async function withMigratedDatabase(
  fn: (database: typeof db) => Promise<void>,
  label = "instance"
): Promise<void> {
  await withThrowawayDatabase(async (pool) => {
    const backup = process.env.MIGRATE_BACKUP;
    process.env.MIGRATE_BACKUP = "0";
    try {
      await applyMigrations(pool);
    } finally {
      if (backup === undefined) delete process.env.MIGRATE_BACKUP;
      else process.env.MIGRATE_BACKUP = backup;
    }

    await fn(drizzle({ client: pool, relations }));
  }, label);
}
