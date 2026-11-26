/**
 * The pure half of the demo snapshot: which checkout and database the scripts
 * refuse, what a snapshot's manifest holds, how an env file is read and
 * edited, the SQL that moves a restored world's timestamps up to today,
 * whether a restored database can be migrated forward, and the order a
 * restore's database steps run in. `snapshot.ts`,
 * `restore.ts` and `demo-env.ts` do the I/O.
 */
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { REPO_ROOT } from "./lookup";

/** The main checkout: the working tree whose `.git` is the repository's common git dir. */
export const mainCheckoutOf = (gitCommonDir: string) =>
  dirname(resolve(gitCommonDir));

/**
 * Refuses the main checkout. Its server env, database and static files are the
 * owner's own, so the scripts that write any of them, or copy them into a
 * snapshot, run only from a linked worktree.
 */
export function assertNotMainCheckoutRoot(
  repoRoot: string,
  mainCheckout: string
): void {
  if (resolve(repoRoot) === resolve(mainCheckout)) {
    throw new Error(
      `${resolve(repoRoot)} is the main checkout, which holds your own data; run the demo scripts from a linked worktree with its own database (.claude/hooks/worktree-setup.sh <path> --db <suffix>)`
    );
  }
}

const SYSTEM_DATABASES = ["postgres", "template0", "template1"];

/**
 * Refuses a database that is not a demo one: the main checkout's, which holds
 * the owner's own data, or one of Postgres's own. When the main checkout's
 * cannot be read, any database might be the owner's, so every one is refused.
 */
export function assertDemoDatabase(
  database: string,
  mainCheckoutDatabase: string | undefined
): void {
  if (!mainCheckoutDatabase) {
    throw new Error(
      `could not read the main checkout's DATABASE_URL, so ${database} may hold the owner's data; refusing it`
    );
  }
  if (
    database === mainCheckoutDatabase ||
    SYSTEM_DATABASES.includes(database)
  ) {
    throw new Error(`refusing ${database}: it is not a demo database`);
  }
}

/**
 * Returns the workspace's notes key once it is sure the key is a demo one,
 * not the owner's: `worktree-setup.sh` copies the main checkout's env, key
 * and all, so a workspace `demo-env` never ran in holds the owner's real key.
 * Refuses a missing key, one equal to the main checkout's, and any key when
 * the main checkout's cannot be read. No error carries either value.
 */
export function assertDemoNotesKey(
  workspaceKey: string | undefined,
  mainCheckoutKey: string | undefined
): string {
  const fix = "run `demo-env` first to give this workspace a demo-only key";
  if (!workspaceKey) {
    throw new Error(
      `this workspace's server env has no NOTES_MASTER_KEY; ${fix}`
    );
  }
  if (!mainCheckoutKey) {
    throw new Error(
      "could not read the main checkout's NOTES_MASTER_KEY, so this workspace's key may be the owner's; refusing"
    );
  }
  if (workspaceKey === mainCheckoutKey) {
    throw new Error(
      `this workspace's NOTES_MASTER_KEY is the main checkout's own; ${fix}`
    );
  }
  return workspaceKey;
}

export const MANIFEST_VERSION = 1;

/** The parts a snapshot directory holds, by file name. */
export const PARTS = ["db.dump", "media.tar", "seed-result.json"] as const;
export type Part = (typeof PARTS)[number];

export interface SnapshotManifest {
  version: typeof MANIFEST_VERSION;
  /** ISO time the snapshot was taken; restore shifts timestamps by now minus this. */
  createdAt: string;
  /** The commit the snapshot was taken at. */
  commit: string;
  /** The newest migration applied to the dumped database, by folder name. */
  migration: string;
  /** The demo-only notes key the seed's API ran with; notes decrypt with it alone. */
  notesMasterKey: string;
  accounts: Record<string, { email: string; password: string }>;
  parts: Record<Part, { bytes: number; sha256: string }>;
}

/** Reads a manifest, refusing one that is not a snapshot this code wrote. */
export function parseManifest(value: unknown): SnapshotManifest {
  const m = value as Partial<SnapshotManifest> | null;
  const problems: string[] = [];
  if (m?.version !== MANIFEST_VERSION)
    problems.push(`version is not ${MANIFEST_VERSION}`);
  if (
    typeof m?.createdAt !== "string" ||
    !Number.isFinite(Date.parse(m.createdAt))
  ) {
    problems.push("createdAt is not a date");
  }
  for (const key of ["commit", "migration", "notesMasterKey"] as const) {
    if (typeof m?.[key] !== "string" || !m[key])
      problems.push(`${key} is missing`);
  }
  if (!m?.accounts || typeof m.accounts !== "object")
    problems.push("accounts is missing");
  for (const part of PARTS) {
    const p = m?.parts?.[part];
    if (typeof p?.bytes !== "number" || typeof p.sha256 !== "string") {
      problems.push(`part ${part} is missing`);
    }
  }
  if (problems.length)
    throw new Error(`not a demo snapshot manifest: ${problems.join("; ")}`);
  return m as SnapshotManifest;
}

/** A workspace's own server env file, relative to its root: the only one these scripts write. */
export const SERVER_ENV = "apps/server/.env";

/** This workspace's own server env file. */
export const WORKSPACE_SERVER_ENV = join(REPO_ROOT, SERVER_ENV);

/** Whether the absolute `path` is `root` or lies under it, by name alone. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function readEnvValue(text: string, key: string): string | undefined {
  const line = text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
  return line?.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/** Sets each key's line, replacing it where it exists and appending it where not. */
export function setEnvValues(
  text: string,
  values: Record<string, string>
): string {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    out = pattern.test(out)
      ? out.replace(pattern, line)
      : `${out.replace(/\n*$/, "\n")}${line}\n`;
  }
  return out;
}

/** The same connection string pointed at another database. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

export const databaseOf = (url: string) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

export interface TimestampColumn {
  table: string;
  column: string;
}

/**
 * Timestamps at or past this are "never" sentinels (a share link that does
 * not expire is stored as the year 9999), not dates, and are left alone.
 */
const SENTINEL_FROM = "9000-01-01";

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * One UPDATE per table moving every timestamp column forward by `shiftMs`,
 * nulls and "never" sentinels untouched, so a restored world reads as it did
 * the day it was seeded: "3 days ago" stays three days ago.
 */
export function shiftTimestampsSql(
  columns: TimestampColumn[],
  shiftMs: number
): string[] {
  if (!Number.isInteger(shiftMs) || shiftMs < 0) {
    throw new Error(
      `a timestamp shift is a whole, non-negative number of ms, not ${shiftMs}`
    );
  }
  if (shiftMs === 0) return [];
  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  return [...byTable].map(([table, cols]) => {
    const sets = cols.map((column) => {
      const c = ident(column);
      return `${c} = CASE WHEN ${c} < '${SENTINEL_FROM}' THEN ${c} + interval '${shiftMs} milliseconds' ELSE ${c} END`;
    });
    return `UPDATE ${ident(table)} SET ${sets.join(", ")}`;
  });
}

export type MigrationPlan =
  | { action: "none" }
  | { action: "forward"; pending: string[] }
  | { action: "reseed"; reason: string };

/**
 * What a restore must do about the schema: nothing when the snapshot is at
 * this checkout's newest migration, run the ones after it when it is behind,
 * and reseed when the snapshot names a migration this checkout does not have
 * (taken on a newer or diverged branch) — data is never edited to fit.
 */
export function migrationPlan(
  snapshotMigration: string,
  repoMigrations: string[]
): MigrationPlan {
  const ordered = [...repoMigrations].sort();
  const at = ordered.indexOf(snapshotMigration);
  if (at === -1) {
    return {
      action: "reseed",
      reason: `the snapshot's schema is at ${snapshotMigration}, which this checkout's migrations do not include`,
    };
  }
  const pending = ordered.slice(at + 1);
  return pending.length ? { action: "forward", pending } : { action: "none" };
}

/** The database half of a restore, one call per step. */
export interface DatabaseRestoreSteps {
  /** Recreates the target database and restores the snapshot's dump into it. */
  restoreDump(): Promise<void>;
  /** Moves every timestamp forward by the snapshot's age. */
  shiftTimestamps(): Promise<void>;
  /** Runs this checkout's migrations newer than the snapshot's. */
  migrate(pending: string[]): Promise<void>;
}

/**
 * Restores the dump, shifts its timestamps, then migrates forward. The shift
 * runs before any migration so it moves only the snapshot's own rows: a row a
 * migration writes with `now()` is already today's, and shifting it would put
 * it in the future.
 */
export async function runDatabaseRestore(
  plan: Exclude<MigrationPlan, { action: "reseed" }>,
  steps: DatabaseRestoreSteps
): Promise<void> {
  await steps.restoreDump();
  await steps.shiftTimestamps();
  if (plan.action === "forward") await steps.migrate(plan.pending);
}
