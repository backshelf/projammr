import { describe, expect, it } from "bun:test";
import {
  assertDemoDatabase,
  assertDemoNotesKey,
  assertNotMainCheckoutRoot,
  databaseOf,
  isInside,
  mainCheckoutOf,
  migrationPlan,
  parseManifest,
  PARTS,
  readEnvValue,
  runDatabaseRestore,
  setEnvValues,
  shiftTimestampsSql,
  withDatabase,
  type DatabaseRestoreSteps,
} from "./snapshot-lib";

const manifest = {
  version: 1,
  createdAt: "2026-09-23T01:00:00.000Z",
  commit: "abc123",
  migration: "20260922053243_saved_view_owner",
  notesMasterKey: "a2V5",
  accounts: { ellis: { email: "ellis@example.com", password: "pw" } },
  parts: Object.fromEntries(PARTS.map((p) => [p, { bytes: 1, sha256: "00" }])),
};

describe("the main checkout", () => {
  const main = mainCheckoutOf("/home/someone/dev/projammr-monorepo/.git");

  it("is the working tree the common git dir belongs to", () => {
    expect(main).toBe("/home/someone/dev/projammr-monorepo");
  });

  it("is refused, however its path is written", () => {
    for (const root of [main, `${main}/`, `${main}/packages/..`]) {
      expect(() => assertNotMainCheckoutRoot(root, main)).toThrow(
        "is the main checkout"
      );
    }
  });

  it("leaves a linked worktree free to run", () => {
    expect(() =>
      assertNotMainCheckoutRoot(
        "/home/someone/orca/workspaces/projammr-monorepo/demo",
        main
      )
    ).not.toThrow();
  });
});

describe("assertDemoDatabase", () => {
  it("refuses the main checkout's database and Postgres's own", () => {
    for (const database of ["projammr", "postgres", "template0", "template1"]) {
      expect(() => assertDemoDatabase(database, "projammr")).toThrow(
        "not a demo database"
      );
    }
  });

  it("allows any other database", () => {
    expect(() => assertDemoDatabase("projammr_demo", "projammr")).not.toThrow();
  });

  it("refuses every database when the main checkout's cannot be read", () => {
    expect(() => assertDemoDatabase("projammr_demo", undefined)).toThrow(
      "could not read the main checkout's DATABASE_URL"
    );
  });
});

describe("assertDemoNotesKey", () => {
  it("returns a workspace key that differs from the main checkout's", () => {
    expect(assertDemoNotesKey("demo-key", "main-key")).toBe("demo-key");
  });

  it("refuses the main checkout's own key, naming the fix but neither value", () => {
    let message = "";
    try {
      assertDemoNotesKey("main-key", "main-key");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("run `demo-env` first");
    expect(message).not.toContain("main-key");
  });

  it("refuses a missing workspace key, and any key when the main checkout's cannot be read", () => {
    expect(() => assertDemoNotesKey(undefined, "main-key")).toThrow(
      "run `demo-env` first"
    );
    expect(() => assertDemoNotesKey("", "main-key")).toThrow(
      "no NOTES_MASTER_KEY"
    );
    expect(() => assertDemoNotesKey("demo-key", undefined)).toThrow(
      "could not read the main checkout's NOTES_MASTER_KEY"
    );
  });
});

describe("parseManifest", () => {
  it("accepts a manifest with every field and part", () => {
    expect(parseManifest(manifest).migration).toBe(manifest.migration);
  });

  it("names everything a broken manifest is missing", () => {
    const broken = { ...manifest, version: 2, createdAt: "later", parts: {} };
    expect(() => parseManifest(broken)).toThrow(
      /version is not 1.*createdAt is not a date.*part db.dump is missing/
    );
  });

  it("refuses something that is not an object", () => {
    expect(() => parseManifest(null)).toThrow("not a demo snapshot manifest");
  });
});

describe("shiftTimestampsSql", () => {
  const columns = [
    { table: "tracks", column: "created_at" },
    { table: "tracks", column: "updated_at" },
    { table: "sharelinks", column: "expires_at" },
  ];

  it("writes one update per table moving each column forward, leaving nulls and never-sentinels", () => {
    expect(shiftTimestampsSql(columns, 86_400_000)).toEqual([
      `UPDATE "tracks" SET "created_at" = CASE WHEN "created_at" < '9000-01-01' THEN "created_at" + interval '86400000 milliseconds' ELSE "created_at" END, "updated_at" = CASE WHEN "updated_at" < '9000-01-01' THEN "updated_at" + interval '86400000 milliseconds' ELSE "updated_at" END`,
      `UPDATE "sharelinks" SET "expires_at" = CASE WHEN "expires_at" < '9000-01-01' THEN "expires_at" + interval '86400000 milliseconds' ELSE "expires_at" END`,
    ]);
  });

  it("quotes identifiers so a name cannot break out of the statement", () => {
    const [sql] = shiftTimestampsSql([{ table: 'a"b', column: "c" }], 1);
    expect(sql).toStartWith(`UPDATE "a""b" SET`);
  });

  it("does nothing for no shift and refuses a negative or fractional one", () => {
    expect(shiftTimestampsSql(columns, 0)).toEqual([]);
    expect(() => shiftTimestampsSql(columns, -1)).toThrow("non-negative");
    expect(() => shiftTimestampsSql(columns, 1.5)).toThrow("whole");
  });
});

describe("migrationPlan", () => {
  const repo = ["0003_c", "0001_a", "0002_b"];

  it("does nothing when the snapshot is at the newest migration", () => {
    expect(migrationPlan("0003_c", repo)).toEqual({ action: "none" });
  });

  it("runs the migrations after the snapshot's, in order", () => {
    expect(migrationPlan("0001_a", repo)).toEqual({
      action: "forward",
      pending: ["0002_b", "0003_c"],
    });
  });

  it("asks for a reseed when the snapshot's migration is not in this checkout", () => {
    const plan = migrationPlan("0004_d", repo);
    expect(plan.action).toBe("reseed");
  });
});

describe("runDatabaseRestore", () => {
  const recorded = () => {
    const calls: string[] = [];
    const steps: DatabaseRestoreSteps = {
      restoreDump: async () => void calls.push("restore the dump"),
      shiftTimestamps: async () => void calls.push("shift timestamps"),
      migrate: async (pending) => void calls.push(`migrate ${pending}`),
    };
    return { calls, steps };
  };

  it("shifts the snapshot's timestamps before migrating, so rows a migration writes stay today's", async () => {
    const { calls, steps } = recorded();
    await runDatabaseRestore(
      { action: "forward", pending: ["0002_b", "0003_c"] },
      steps
    );
    expect(calls).toEqual([
      "restore the dump",
      "shift timestamps",
      "migrate 0002_b,0003_c",
    ]);
  });

  it("migrates nothing when the snapshot is at the newest migration", async () => {
    const { calls, steps } = recorded();
    await runDatabaseRestore({ action: "none" }, steps);
    expect(calls).toEqual(["restore the dump", "shift timestamps"]);
  });
});

describe("env files", () => {
  const text = 'DATABASE_URL="postgres://u:p@localhost:5432/demo"\nPORT=8083\n';

  it("reads a value with or without quotes", () => {
    expect(readEnvValue(text, "DATABASE_URL")).toBe(
      "postgres://u:p@localhost:5432/demo"
    );
    expect(readEnvValue(text, "PORT")).toBe("8083");
    expect(readEnvValue(text, "MISSING")).toBeUndefined();
  });

  it("replaces an existing line and appends a new one", () => {
    const out = setEnvValues(text, { PORT: "9000", TZ: "UTC" });
    expect(out).toBe(
      'DATABASE_URL="postgres://u:p@localhost:5432/demo"\nPORT="9000"\nTZ="UTC"\n'
    );
  });
});

describe("isInside", () => {
  it("holds for the root and anything under it", () => {
    expect(isInside("/w", "/w")).toBe(true);
    expect(isInside("/w", "/w/apps/server/static")).toBe(true);
    expect(isInside("/w", "/w/..static")).toBe(true);
  });

  it("fails for a parent, a sibling and a name that only starts the same", () => {
    expect(isInside("/w/a", "/w")).toBe(false);
    expect(isInside("/w/a", "/w/b/static")).toBe(false);
    expect(isInside("/w/a", "/w/ab")).toBe(false);
  });
});

describe("database urls", () => {
  it("points a connection string at another database and reads it back", () => {
    const url = withDatabase(
      "postgres://u:p@localhost:5432/one?sslmode=disable",
      "two"
    );
    expect(url).toBe("postgres://u:p@localhost:5432/two?sslmode=disable");
    expect(databaseOf(url)).toBe("two");
  });
});
