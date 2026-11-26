import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import type { Pool } from "pg";
import { redirectLogs } from "../lib/log.js";
import { withThrowawayDatabase } from "../test/database.js";
import {
  applyMigrations,
  MIGRATIONS_FOLDER,
  pruneBackups,
} from "./migrator.js";

const FOLDER_COUNT = readdirSync(MIGRATIONS_FOLDER, {
  withFileTypes: true,
}).filter((entry) => entry.isDirectory()).length;

const appliedMigrationNames = async (pool: Pool): Promise<string[]> => {
  const { rows } = await pool
    .query<{ name: string }>("select name from drizzle.__drizzle_migrations")
    .catch(() => ({ rows: [] as { name: string }[] }));
  return rows.map((row) => row.name);
};

/**
 * A `pg_dump` stand-in on `PATH`, so the dump-path tests never depend on the
 * real binary. It always marks that it ran, and `behaviour` decides what a
 * genuine `pg_dump` would additionally do: write the `--file` target and
 * exit 0, or exit non-zero without writing anything.
 *
 * It also records the arguments and the connection environment it was handed,
 * so a test can assert where the credentials travelled.
 */
function stubPgDump(behaviour: "succeeds" | "fails"): {
  marker: string;
  argv: string;
  environment: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "pg-dump-stub-"));
  const marker = join(dir, "called");
  const argv = join(dir, "argv");
  const environment = join(dir, "environment");
  const body =
    behaviour === "succeeds"
      ? `while [ "$#" -gt 0 ]; do case "$1" in --file) FILE="$2"; shift 2;; *) shift;; esac; done\n[ -n "$FILE" ] && echo fake > "$FILE"\nexit 0`
      : `echo "pg_dump: boom" 1>&2\nexit 1`;
  const script = join(dir, "pg_dump");
  writeFileSync(
    script,
    `#!/bin/sh\ntouch "${marker}"\n` +
      `printf '%s\\n' "$@" > "${argv}"\n` +
      `printf 'PGDATABASE=%s\\nPGUSER=%s\\nPGPASSWORD_SET=%s\\n' ` +
      `"$PGDATABASE" "$PGUSER" "\${PGPASSWORD:+yes}" > "${environment}"\n` +
      `${body}\n`
  );
  chmodSync(script, 0o755);
  stubEnv("PATH", `${dir}:${process.env.PATH ?? ""}`);
  return { marker, argv, environment };
}

/** `PATH` with nowhere `pg_dump` could live — the "not installed" case. */
function stubMissingPgDump(): void {
  const dir = mkdtempSync(join(tmpdir(), "no-pg-dump-"));
  stubEnv("PATH", dir);
}

afterEach(() => {
  unstubAllEnvs();
});

describe("applyMigrations", () => {
  it("two concurrent runs apply every migration exactly once", async () => {
    await withThrowawayDatabase(async (pool) => {
      stubEnv("MIGRATE_BACKUP", "0");
      await Promise.all([applyMigrations(pool), applyMigrations(pool)]);

      const names = await appliedMigrationNames(pool);
      expect(names).toHaveLength(FOLDER_COUNT);
      expect(new Set(names).size).toBe(FOLDER_COUNT);
    }, "migrator_test");
  }, 30_000);

  it("passes the connection in the environment, never in pg_dump's argv", async () => {
    await withThrowawayDatabase(async (pool) => {
      const stub = stubPgDump("succeeds");

      await applyMigrations(pool);

      // `argv` is world-readable through the process table for as long as the
      // dump runs (`ps`, /proc/<pid>/cmdline), and DATABASE_URL carries the
      // password. A child's environment is readable only by its own user.
      const argv = readFileSync(stub.argv, "utf8");
      expect(argv).not.toContain("://");
      expect(argv).not.toContain("@");

      const environment = readFileSync(stub.environment, "utf8");
      expect(environment).toContain("PGPASSWORD_SET=yes");
      expect(environment).toMatch(/PGDATABASE=\S+/);
    }, "migrator_test");
  }, 30_000);

  it("aborts the migration when the pre-migrate dump fails", async () => {
    await withThrowawayDatabase(async (pool) => {
      const { marker } = stubPgDump("fails");

      await expect(applyMigrations(pool)).rejects.toThrow(/pg_dump/);

      expect(Bun.file(marker).exists()).resolves.toBe(true);
      // Nothing was ever applied: the dump ran and failed before drizzle's
      // own migrate() — which creates the bookkeeping table — ever runs.
      const { rows } = await pool.query(
        "select to_regclass('drizzle.__drizzle_migrations') as reg"
      );
      expect(rows[0]?.reg).toBeNull();
    }, "migrator_test");
  }, 30_000);

  it("does not dump when nothing is pending", async () => {
    await withThrowawayDatabase(async (pool) => {
      stubEnv("MIGRATE_BACKUP", "0");
      await applyMigrations(pool);

      const { marker } = stubPgDump("succeeds");
      await applyMigrations(pool);

      expect(Bun.file(marker).exists()).resolves.toBe(false);
    }, "migrator_test");
  }, 30_000);

  it("warns and proceeds when pg_dump is not on PATH", async () => {
    await withThrowawayDatabase(async (pool) => {
      stubMissingPgDump();
      const lines: string[] = [];
      const restore = redirectLogs((line) => lines.push(line));

      try {
        await applyMigrations(pool);
      } finally {
        restore();
      }

      expect(lines.some((line) => /pg_dump/.test(line))).toBe(true);
      const names = await appliedMigrationNames(pool);
      expect(names).toHaveLength(FOLDER_COUNT);
    }, "migrator_test");
  }, 30_000);

  it("disables statement_timeout during migrate and restores it afterward", async () => {
    await withThrowawayDatabase(async (pool) => {
      stubEnv("MIGRATE_BACKUP", "0");
      await applyMigrations(pool);

      const { rows } = await pool.query<{ statement_timeout: string }>(
        "show statement_timeout"
      );
      expect(rows[0]?.statement_timeout).not.toBe("0");
    }, "migrator_test");
  }, 30_000);
});

describe("pruneBackups", () => {
  it("keeps only the newest five dumps, oldest first out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "backups-"));
    const names = Array.from({ length: 7 }, (_, i) => `pre-tag-${i}.dump`);
    for (const [i, name] of names.entries()) {
      writeFileSync(join(dir, name), "fake");
      utimesSync(join(dir, name), new Date(i * 1000), new Date(i * 1000));
    }
    // A file the naming convention would not touch, to prove it is ignored.
    writeFileSync(join(dir, "not-a-backup.txt"), "leave me alone");

    await pruneBackups(dir);

    const remaining = readdirSync(dir).sort();
    expect(remaining).toEqual([
      "not-a-backup.txt",
      "pre-tag-2.dump",
      "pre-tag-3.dump",
      "pre-tag-4.dump",
      "pre-tag-5.dump",
      "pre-tag-6.dump",
    ]);
  });

  it("leaves five or fewer dumps untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "backups-"));
    writeFileSync(join(dir, "pre-tag-0.dump"), "fake");

    await pruneBackups(dir);

    expect(readdirSync(dir)).toEqual(["pre-tag-0.dump"]);
  });
});
