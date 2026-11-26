/**
 * Saves the seeded demo world so a later screenshot run can restore it in
 * seconds instead of seeding again: a custom-format dump of this workspace's
 * database, a tarball of its server's static files (every upload and derived
 * file the rows point at), the seed's result file, and a `snapshot.json`
 * manifest (when, at which commit and migration, the demo notes key, the demo
 * accounts, and a checksum of each part). It refuses while any server job is
 * still queued or running, and anywhere but a linked worktree whose env names
 * a demo database and holds a demo notes key (`demo-env`): the main
 * checkout's data and key are the owner's own.
 *
 *   bun run --cwd packages/demo snapshot [-- --inputs ~/projammr-demo-audio] [--pg-container pj-dev-pg]
 *
 * Writes `<inputs>/snapshots/<created-at>/` and points `<inputs>/snapshots/latest`
 * at it. A snapshot holds the owner's audio, so it lives outside the
 * repository and is never committed. The seed remains the source of truth:
 * `seed.ts` then this script whenever the catalogue or the schema moves on.
 */
import { $, SQL } from "bun";
import { mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./lookup";
import { dumpDatabase } from "./pg-tools";
import type { SeedResult } from "./seed-result";
import {
  assertInWorkspace,
  assertNotMainCheckout,
  assertNotOwnerDatabase,
  assertWorkspaceEnv,
  demoNotesKey,
  readServerEnv,
  sha256,
  snapshotsDir,
  WORKSPACE_STATIC,
} from "./snapshot-io";
import {
  databaseOf,
  MANIFEST_VERSION,
  PARTS,
  type SnapshotManifest,
  WORKSPACE_SERVER_ENV,
} from "./snapshot-lib";

await assertNotMainCheckout();

const { values } = parseArgs({
  options: {
    inputs: { type: "string", default: join(homedir(), "projammr-demo-audio") },
    "server-env": { type: "string", default: WORKSPACE_SERVER_ENV },
    static: { type: "string", default: WORKSPACE_STATIC },
    "pg-container": { type: "string" },
  },
});

const envPath = await assertWorkspaceEnv(values["server-env"]);
const staticDir = await assertInWorkspace(values.static);
const { text, url } = await readServerEnv(envPath);
await assertNotOwnerDatabase(databaseOf(url));
const notesMasterKey = await demoNotesKey(text);
const seedFile = join(values.inputs, "seed-result.json");
const seed = (await Bun.file(seedFile).json()) as SeedResult;

const sql = new SQL({ url, max: 1 });
let migration: string;
try {
  const [busy] =
    await sql`select count(*)::int as n from jobs where status in ('queued', 'running')`;
  if (busy.n > 0)
    throw new Error(
      `${busy.n} server jobs are still queued or running; wait for them`
    );
  const [latest] =
    await sql`select name from drizzle.__drizzle_migrations order by id desc limit 1`;
  migration = latest?.name;
  if (!migration) throw new Error("the database records no applied migration");
} finally {
  await sql.close();
}

const createdAt = new Date().toISOString();
const dir = join(snapshotsDir(values.inputs), createdAt.replace(/[:.]/g, "-"));
await mkdir(dir, { recursive: true });

console.log(`dumping ${basename(new URL(url).pathname)}`);
await dumpDatabase(url, join(dir, "db.dump"), values["pg-container"]);
console.log(`packing ${staticDir}`);
await $`tar -cf ${join(dir, "media.tar")} -C ${staticDir} .`;
await Bun.write(join(dir, "seed-result.json"), Bun.file(seedFile));

const parts = Object.fromEntries(
  await Promise.all(
    PARTS.map(async (part) => {
      const path = join(dir, part);
      return [
        part,
        { bytes: Bun.file(path).size, sha256: await sha256(path) },
      ] as const;
    })
  )
) as SnapshotManifest["parts"];

const manifest: SnapshotManifest = {
  version: MANIFEST_VERSION,
  createdAt,
  commit: (await $`git -C ${REPO_ROOT} rev-parse HEAD`.text()).trim(),
  migration,
  notesMasterKey,
  accounts: seed.accounts,
  parts,
};
await Bun.write(
  join(dir, "snapshot.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

const latest = join(snapshotsDir(values.inputs), "latest");
await rm(latest, { force: true });
await symlink(basename(dir), latest);

const mb = Object.values(parts).reduce((sum, p) => sum + p.bytes, 0) / 1048576;
console.log(
  `snapshot ${dir} (${mb.toFixed(0)} MB, schema at ${migration}); latest points at it`
);
