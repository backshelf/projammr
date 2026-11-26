import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setCargoLockVersion,
  setCargoLockVersions,
  setCargoTomlVersion,
  setCargoWorkspaceVersion,
  setBunLockVersions,
  setManifestVersion,
  syncVersion,
  workspaceManifests,
} from "./sync-version";

const manifest = (name: string, version: string) =>
  `{\n  "name": "${name}",\n  "version": "${version}",\n  "files": ["a", "b"],\n  "dependencies": {\n    "x": "1.0.0"\n  }\n}\n`;

const cargoToml = (version: string) =>
  `[package]\nname = "projammr_dsp"\nversion = "${version}"\nedition = "2024"\n\n[dependencies]\nrubato = { version = "1.0.0" }\n`;

const cargoLock = (version: string) =>
  `[[package]]\nname = "rubato"\nversion = "1.0.0"\n\n[[package]]\nname = "projammr_dsp"\nversion = "${version}"\ndependencies = [\n "rubato",\n]\n`;

const ditToml = (version: string) =>
  `[workspace]\nresolver = "3"\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "${version}"\nedition = "2024"\n\n[workspace.dependencies]\nclap = { version = "0.0.0", features = ["derive"] }\nhex = "0.0.0"\n\n[profile.release]\nlto = true\n`;

// The app's crate is a package of its own workspace, beside the dit-* path dependencies it locks.
const appToml = (version: string) =>
  `[package]\nname = "dit-app"\nversion = "${version}"\nedition = "2024"\n\n[dependencies]\ntauri = { version = "2.12.4" }\n`;

const appLock = (version: string) =>
  `[[package]]\nname = "dit-app"\nversion = "${version}"\ndependencies = [\n "dit-core",\n "tauri",\n]\n\n[[package]]\nname = "dit-core"\nversion = "${version}"\n\n[[package]]\nname = "tauri"\nversion = "2.12.4"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc"\n`;

// A registry package carries the same version string as the members and must stay.
const ditLock = (version: string) =>
  `[[package]]\nname = "dit-cli"\nversion = "${version}"\ndependencies = [\n "dit-core",\n]\n\n[[package]]\nname = "dit-core"\nversion = "${version}"\n\n[[package]]\nname = "dit-wasm"\nversion = "${version}"\ndependencies = [\n "dit-core",\n]\n\n[[package]]\nname = "hex"\nversion = "0.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc"\n`;

// The `packages` entry for `a` shares its name with a workspace and must stay as it is.
const bunLock = (a: string, b: string) =>
  `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "root",\n    },\n    "packages/a": {\n      "name": "a",\n      "version": "${a}",\n      "dependencies": {\n        "x": "1.0.0",\n      },\n    },\n    "apps/b": {\n      "name": "b",\n      "version": "${b}",\n    },\n  },\n  "packages": {\n    "a": ["a@workspace:packages/a"],\n    "x": ["x@1.0.0", "", {}, "sha"],\n  },\n}\n`;

let root: string;

function write(file: string, text: string) {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

const read = (file: string) => readFileSync(join(root, file), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sync-version-"));
  write(
    "package.json",
    `{\n  "name": "root",\n  "version": "0.9.0",\n  "workspaces": [\n    "packages/*",\n    "apps/*"\n  ]\n}\n`
  );
  write("packages/a/package.json", manifest("a", "0.0.1"));
  write("apps/b/package.json", manifest("b", "1.0.0"));
  write("packages/dsp/package.json", manifest("dsp", "0.0.0"));
  write("packages/dsp/rust/Cargo.toml", cargoToml("0.0.0"));
  write("packages/dsp/rust/Cargo.lock", cargoLock("0.0.0"));
  write("packages/dit/Cargo.toml", ditToml("0.0.0"));
  write("packages/dit/Cargo.lock", ditLock("0.0.0"));
  write("apps/dit-app/src-tauri/Cargo.toml", appToml("0.0.0"));
  write("apps/dit-app/src-tauri/Cargo.lock", appLock("0.0.0"));
  write("bun.lock", bunLock("0.0.1", "1.0.0"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("version setters", () => {
  test("setManifestVersion changes only the top-level version", () => {
    const text = `{\n  "version": "1.0.0",\n  "nested": {\n    "version": "2.0.0"\n  }\n}\n`;
    expect(setManifestVersion(text, "0.9.0")).toBe(
      `{\n  "version": "0.9.0",\n  "nested": {\n    "version": "2.0.0"\n  }\n}\n`
    );
  });

  test("setCargoTomlVersion leaves dependency versions alone", () => {
    expect(setCargoTomlVersion(cargoToml("0.0.0"), "0.9.0")).toBe(
      cargoToml("0.9.0")
    );
  });

  test("setCargoLockVersion changes only the workspace crate's entry", () => {
    expect(setCargoLockVersion(cargoLock("0.0.0"), "0.9.0")).toBe(
      cargoLock("0.9.0")
    );
  });
});

describe("setCargoWorkspaceVersion", () => {
  test("changes the workspace package version and leaves dependency versions alone", () => {
    expect(setCargoWorkspaceVersion(ditToml("0.0.0"), "0.9.0")).toBe(
      ditToml("0.9.0")
    );
  });

  test("throws when the manifest has no [workspace.package] version", () => {
    const text = `[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nclap = { version = "4.6.7" }\nhex = "0.4.3"\n`;
    expect(() => setCargoWorkspaceVersion(text, "0.9.0")).toThrow(
      "[workspace.package]"
    );
  });
});

describe("setCargoLockVersions", () => {
  const isMember = (name: string) => name.startsWith("dit-");

  test("changes every member entry and leaves a registry package with the same version", () => {
    expect(setCargoLockVersions(ditLock("0.0.0"), "0.9.0", isMember)).toBe(
      ditLock("0.9.0")
    );
  });
});

describe("setBunLockVersions", () => {
  test("sets each workspace entry and leaves the packages block alone", () => {
    const out = setBunLockVersions(bunLock("0.0.1", "1.0.0"), "0.9.0", [
      "packages/a",
      "apps/b",
    ]);
    expect(out).toBe(bunLock("0.9.0", "0.9.0"));
  });

  test("skips a workspace whose entry carries no version", () => {
    const text = bunLock("0.0.1", "1.0.0");
    expect(setBunLockVersions(text, "0.9.0", ["packages/none"])).toBe(text);
  });
});

describe("workspaceManifests", () => {
  test("resolves the root globs at run time", () => {
    write("packages/late/package.json", manifest("late", "0.0.0"));
    expect(workspaceManifests(root)).toEqual([
      "apps/b/package.json",
      "packages/a/package.json",
      "packages/dsp/package.json",
      "packages/late/package.json",
    ]);
  });
});

describe("syncVersion", () => {
  test("sets every workspace, Cargo.toml and Cargo.lock to the root version", () => {
    const changed = syncVersion(root);
    expect(changed).toHaveLength(10);
    expect(read("packages/dit/Cargo.toml")).toBe(ditToml("0.9.0"));
    expect(read("packages/dit/Cargo.lock")).toBe(ditLock("0.9.0"));
    expect(read("apps/dit-app/src-tauri/Cargo.toml")).toBe(appToml("0.9.0"));
    expect(read("apps/dit-app/src-tauri/Cargo.lock")).toBe(appLock("0.9.0"));
    expect(read("bun.lock")).toBe(bunLock("0.9.0", "0.9.0"));
    expect(read("apps/b/package.json")).toBe(manifest("b", "0.9.0"));
    expect(read("packages/dsp/rust/Cargo.toml")).toBe(cargoToml("0.9.0"));
    expect(read("packages/dsp/rust/Cargo.lock")).toBe(cargoLock("0.9.0"));
  });

  test("never touches the root manifest", () => {
    const before = read("package.json");
    syncVersion(root);
    expect(read("package.json")).toBe(before);
  });

  test("a second run changes nothing", () => {
    syncVersion(root);
    expect(syncVersion(root)).toEqual([]);
  });

  test("--check lists the differing files and writes nothing", () => {
    const before = read("packages/a/package.json");
    expect(syncVersion(root, { check: true })).toContain(
      "packages/a/package.json"
    );
    expect(read("packages/a/package.json")).toBe(before);
  });

  test("--check flags a drifted bun.lock on its own", () => {
    syncVersion(root);
    write("bun.lock", bunLock("0.9.0", "0.8.0"));
    expect(syncVersion(root, { check: true })).toEqual(["bun.lock"]);
    expect(read("bun.lock")).toBe(bunLock("0.9.0", "0.8.0"));
  });

  test("--check reports nothing once synced", () => {
    syncVersion(root);
    expect(syncVersion(root, { check: true })).toEqual([]);
  });

  test("covers a workspace added after the script was written", () => {
    write("packages/late/package.json", manifest("late", "0.0.0"));
    syncVersion(root);
    expect(read("packages/late/package.json")).toBe(manifest("late", "0.9.0"));
  });
});
