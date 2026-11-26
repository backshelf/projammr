/**
 * The I/O the demo scripts share: file digests, where snapshots live, this
 * checkout's migrations, and the main checkout and its database (which the
 * scripts must never touch).
 */
import { $ } from "bun";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { REPO_ROOT } from "./lookup";
import {
  assertDemoDatabase,
  assertDemoNotesKey,
  assertNotMainCheckoutRoot,
  databaseOf,
  isInside,
  mainCheckoutOf,
  readEnvValue,
  SERVER_ENV,
  setEnvValues,
} from "./snapshot-lib";

export const SERVER_DIR = join(REPO_ROOT, "apps/server");
export const WORKSPACE_STATIC = join(SERVER_DIR, "static");
const MIGRATIONS_DIR = join(SERVER_DIR, "src/db/migrations");

export const snapshotsDir = (inputs: string) => join(inputs, "snapshots");

export async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** This checkout's migrations, by folder name. */
export async function repoMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** The real path of `path`, or of its nearest existing ancestor with the rest appended. */
async function realpathOrAncestor(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissing(error) || dirname(path) === path) throw error;
    return join(await realpathOrAncestor(dirname(path)), basename(path));
  }
}

/**
 * The real location of `path`, refusing one that is itself a symlink or that
 * really lies outside the workspace at `root`: a link inside the worktree could
 * otherwise lead the scripts into the main checkout. A path that does not
 * exist yet (a static dir a restore creates) is placed through its parent.
 */
export async function assertInWorkspace(
  path: string,
  root = REPO_ROOT
): Promise<string> {
  const resolved = resolve(path);
  if (await isSymlink(resolved)) {
    throw new Error(`${resolved} is a symlink; refusing to touch it`);
  }
  const real = await realpathOrAncestor(resolved);
  if (!isInside(await realpath(root), real)) {
    throw new Error(
      `${resolved} is outside this workspace (it resolves to ${real}); refusing to touch it`
    );
  }
  return real;
}

/** Refuses an env file other than the workspace's own server env, where it really lies. */
export async function assertWorkspaceEnv(
  path: string,
  root = REPO_ROOT
): Promise<string> {
  const resolved = resolve(path);
  const own = join(root, SERVER_ENV);
  if (resolved !== own) {
    throw new Error(
      `${resolved} is not this workspace's server env (${own}); refusing to touch it`
    );
  }
  return assertInWorkspace(resolved, root);
}

export async function readServerEnv(path: string) {
  const text = await Bun.file(path).text();
  const url = readEnvValue(text, "DATABASE_URL");
  if (!url) throw new Error(`${path} has no DATABASE_URL`);
  return { text, url };
}

async function mainCheckout(): Promise<string> {
  const common =
    await $`git -C ${REPO_ROOT} rev-parse --path-format=absolute --git-common-dir`
      .quiet()
      .nothrow();
  if (common.exitCode !== 0) {
    throw new Error(
      `cannot tell whether ${REPO_ROOT} is the main checkout (git rev-parse failed); refusing to run`
    );
  }
  return mainCheckoutOf(common.text().trim());
}

/**
 * Stops a demo script that would write an env, a database, static files or a
 * snapshot when it runs from the main checkout rather than a linked worktree.
 */
export async function assertNotMainCheckout(): Promise<void> {
  assertNotMainCheckoutRoot(
    await realpath(REPO_ROOT),
    await realpath(await mainCheckout())
  );
}

/**
 * The server env of the main checkout at `main` (found through git when not
 * given), whose database and notes key are the owner's own; undefined when
 * there is none to read.
 */
async function mainCheckoutEnv(main?: string): Promise<string | undefined> {
  const env = Bun.file(join(main ?? (await mainCheckout()), SERVER_ENV));
  return (await env.exists()) ? env.text() : undefined;
}

/** Stops a demo script before it writes to, restores over or dumps a database that is not a demo one. */
export async function assertNotOwnerDatabase(
  database: string,
  main?: string
): Promise<void> {
  const env = await mainCheckoutEnv(main);
  const url = env === undefined ? undefined : readEnvValue(env, "DATABASE_URL");
  assertDemoDatabase(database, url ? databaseOf(url) : undefined);
}

/**
 * The notes key a workspace's server env holds, once it is sure the key is a
 * demo one and not the main checkout's (`assertDemoNotesKey`).
 */
export async function demoNotesKey(
  envText: string,
  main?: string
): Promise<string> {
  const env = await mainCheckoutEnv(main);
  return assertDemoNotesKey(
    readEnvValue(envText, "NOTES_MASTER_KEY"),
    env === undefined ? undefined : readEnvValue(env, "NOTES_MASTER_KEY")
  );
}

/**
 * Writes a fresh demo-only notes key into a workspace's server env,
 * refusing one that names the main checkout's database: a server run on it
 * would write the owner's notes under the demo key.
 */
export async function writeDemoEnv(
  envPath: string,
  notesMasterKey: string,
  main?: string
): Promise<void> {
  const { text, url } = await readServerEnv(envPath);
  await assertNotOwnerDatabase(databaseOf(url), main);
  await Bun.write(
    envPath,
    setEnvValues(text, { NOTES_MASTER_KEY: notesMasterKey })
  );
}
