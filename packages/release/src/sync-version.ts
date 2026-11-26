import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RUST_DIR = "packages/dsp/rust";
const DIT_DIR = "packages/dit";
const DIT_APP_DIR = "apps/dit-app/src-tauri";
const CRATE_NAME = "projammr_dsp";

/** The repository root, found from this file's location (`packages/release/src`). */
export const REPO_ROOT = resolve(import.meta.dir, "../../..");

/** Replaces the top-level `"version"` value of a formatted package.json, leaving every other byte alone. */
export function setManifestVersion(text: string, version: string): string {
  return text.replace(/^( {2}"version": ")[^"]*(")/m, `$1${version}$2`);
}

/** Replaces the `[package]` version of a Cargo.toml. */
export function setCargoTomlVersion(text: string, version: string): string {
  return text.replace(/^(version = ")[^"]*(")/m, `$1${version}$2`);
}

/** Replaces the version of the workspace's own crate in a Cargo.lock. */
export function setCargoLockVersion(text: string, version: string): string {
  return text.replace(
    new RegExp(`^(name = "${CRATE_NAME}"\\nversion = ")[^"]*(")`, "m"),
    `$1${version}$2`
  );
}

/**
 * Replaces the `version` under `[workspace.package]` of a virtual Cargo workspace manifest. The
 * `version = "…"` entries under `[workspace.dependencies]` are dependency requirements and stay.
 */
export function setCargoWorkspaceVersion(
  text: string,
  version: string
): string {
  const section = /^\[workspace\.package\]\n(?:(?!\[).*\n?)*/m.exec(text);
  const line = section && /^(version = ")[^"]*(")/m.exec(section[0]);
  if (!section || !line) {
    throw new Error("no version under [workspace.package]");
  }
  const start = section.index + line.index;
  return (
    text.slice(0, start) +
    `${line[1]}${version}${line[2]}` +
    text.slice(start + line[0].length)
  );
}

/**
 * Replaces the version of every workspace member in a Cargo.lock; `isMember` says which crate names
 * are members, so a registry package that shares the version string is left alone.
 */
export function setCargoLockVersions(
  text: string,
  version: string,
  isMember: (name: string) => boolean
): string {
  return text.replace(
    /^(name = "([^"]*)"\nversion = ")[^"]*(")(?=\n(?!source ))/gm,
    (whole, head: string, name: string, tail: string) =>
      isMember(name) ? `${head}${version}${tail}` : whole
  );
}

/** Sets the version of every `dit-*` crate in a Cargo.lock: the members of the dit workspace and of the app. */
function setDitCargoLockVersions(text: string, version: string): string {
  return setCargoLockVersions(text, version, (name) => name.startsWith("dit-"));
}

/**
 * Replaces the version of each listed workspace directory's entry in bun.lock. Only the top-level
 * `"workspaces"` block is edited, never the `"packages"` entries that share a workspace's name.
 */
export function setBunLockVersions(
  text: string,
  version: string,
  workspaceDirs: string[]
): string {
  const start = text.indexOf('\n  "workspaces": {\n');
  const end = text.indexOf("\n  },\n", start);
  if (start === -1 || end === -1) return text;
  let block = text.slice(start, end);
  for (const dir of workspaceDirs) {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    block = block.replace(
      new RegExp(
        `^( {4}"${escaped}": \\{\\n {6}"name": "[^"]*",\\n {6}"version": ")[^"]*(")`,
        "m"
      ),
      `$1${version}$2`
    );
  }
  return text.slice(0, start) + block + text.slice(end);
}

function readManifest(path: string): {
  version: string;
  workspaces?: string[];
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The product version: the root package.json's `version`. */
export function readRootVersion(root: string): string {
  return readManifest(join(root, "package.json")).version;
}

/** Every workspace manifest the root `workspaces` globs resolve to, as paths relative to the root. */
export function workspaceManifests(root: string): string[] {
  const patterns = readManifest(join(root, "package.json")).workspaces ?? [];
  return patterns
    .flatMap((pattern) => [
      ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root }),
    ])
    .sort();
}

/** The files a sync manages, each with the function that sets its version. */
function managedFiles(
  root: string
): [string, (text: string, v: string) => string][] {
  const manifests = workspaceManifests(root);
  const dirs = manifests.map((file) => dirname(file));
  return [
    ...manifests.map((file): [string, typeof setManifestVersion] => [
      file,
      setManifestVersion,
    ]),
    [`${RUST_DIR}/Cargo.toml`, setCargoTomlVersion],
    [`${RUST_DIR}/Cargo.lock`, setCargoLockVersion],
    [`${DIT_DIR}/Cargo.toml`, setCargoWorkspaceVersion],
    [`${DIT_DIR}/Cargo.lock`, setDitCargoLockVersions],
    // The app's own Cargo workspace: its crate and the dit-* path dependencies it
    // locks all carry the product version; tauri's crates do not start with `dit-`.
    [`${DIT_APP_DIR}/Cargo.toml`, setCargoTomlVersion],
    [`${DIT_APP_DIR}/Cargo.lock`, setDitCargoLockVersions],
    ["bun.lock", (text, v) => setBunLockVersions(text, v, dirs)],
  ];
}

/**
 * Brings every managed file to the root version. With `check` nothing is written.
 * Returns the files (relative to the root) whose version differed.
 */
export function syncVersion(root: string, { check = false } = {}): string[] {
  const version = readRootVersion(root);
  const changed: string[] = [];
  for (const [file, set] of managedFiles(root)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, "utf8");
    const after = set(before, version);
    if (after === before) continue;
    changed.push(file);
    if (!check) writeFileSync(path, after);
  }
  return changed;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const version = readRootVersion(REPO_ROOT);
  const changed = syncVersion(REPO_ROOT, { check });
  if (check && changed.length > 0) {
    console.error(`These files are not at ${version}:`);
    for (const file of changed) console.error(`  ${file}`);
    console.error("Run `bun run version:sync` and commit the result.");
    process.exit(1);
  }
  console.log(
    check
      ? `Every file is at ${version}.`
      : `${changed.length} file(s) set to ${version}.`
  );
}
