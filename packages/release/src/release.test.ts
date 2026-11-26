import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasUnreleasedSection,
  parseReleaseVersion,
  release,
  rewriteChangelog,
} from "./release";

const changelog = `# Changelog

## [Unreleased]

### Added

- Something.

## [0.9.0] - 2026-01-01

- Older.

[Unreleased]: https://github.com/o/r/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/o/r/releases/tag/v0.9.0
`;

describe("parseReleaseVersion", () => {
  test.each(["1.0.0", "0.9.1", "1.0.0-rc.1", "12.30.4-rc.12"])(
    "accepts %s",
    (arg) => {
      expect(parseReleaseVersion(arg)).toEqual({ version: arg });
    }
  );

  test.each([
    undefined,
    "",
    "1.0",
    "v1.0.0",
    "1.0.0-beta.1",
    "1.0.0-rc",
    "1.0.0 ",
  ])("refuses %p", (arg) => {
    expect(parseReleaseVersion(arg)).toHaveProperty("error");
  });
});

describe("rewriteChangelog", () => {
  test("dates the Unreleased section and puts a fresh one above it", () => {
    const out = rewriteChangelog(changelog, "1.0.0", "2026-10-01");
    expect(out).toContain(
      "## [Unreleased]\n\n## [1.0.0] - 2026-10-01\n\n### Added\n\n- Something."
    );
    expect(out.indexOf("## [Unreleased]")).toBeLessThan(
      out.indexOf("## [1.0.0]")
    );
    expect(out.indexOf("## [1.0.0]")).toBeLessThan(out.indexOf("## [0.9.0]"));
  });

  test("moves the compare link on and adds one for the new version", () => {
    const out = rewriteChangelog(changelog, "1.0.0", "2026-10-01");
    expect(out).toContain(
      "[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD\n[1.0.0]: https://github.com/o/r/compare/v0.9.0...v1.0.0\n[0.9.0]:"
    );
  });

  test("leaves a changelog without links free of them", () => {
    const out = rewriteChangelog(
      "## [Unreleased]\n\n- A.\n",
      "1.0.0",
      "2026-10-01"
    );
    expect(out).toBe("## [Unreleased]\n\n## [1.0.0] - 2026-10-01\n\n- A.\n");
  });
});

describe("hasUnreleasedSection", () => {
  test("finds the heading and refuses its absence", () => {
    expect(hasUnreleasedSection(changelog)).toBe(true);
    expect(
      hasUnreleasedSection("# Changelog\n\n## [1.0.0] - 2026-01-01\n")
    ).toBe(false);
  });
});

describe("release", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "release-"));
    dirs.push(dir);
    const run = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: dir });
      expect(r.exitCode).toBe(0);
      return r.stdout.toString();
    };
    run("init", "-q", "-b", "main");
    run("config", "user.email", "t@example.com");
    run("config", "user.name", "T");
    run("config", "commit.gpgsign", "false");
    run("config", "tag.gpgsign", "false");
    writeFileSync(
      join(dir, "package.json"),
      `{\n  "name": "root",\n  "version": "0.9.0",\n  "workspaces": [\n    "packages/*"\n  ]\n}\n`
    );
    Bun.spawnSync(["mkdir", "-p", join(dir, "packages/a")]);
    writeFileSync(
      join(dir, "packages/a/package.json"),
      `{\n  "name": "a",\n  "version": "0.9.0"\n}\n`
    );
    writeFileSync(join(dir, "CHANGELOG.md"), changelog);
    run("add", "-A");
    run("commit", "-q", "-m", "init");
    return dir;
  }

  const git = (dir: string, ...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: dir })
      .stdout.toString()
      .trim();

  test("commits exactly the changed files and makes an annotated tag", () => {
    const dir = repo();
    release(dir, "1.0.0", "2026-10-01");
    expect(git(dir, "log", "-1", "--format=%s")).toBe("chore(release): 1.0.0");
    expect(
      git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()
    ).toEqual(["CHANGELOG.md", "package.json", "packages/a/package.json"]);
    expect(git(dir, "cat-file", "-t", "v1.0.0")).toBe("tag");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(
      readFileSync(join(dir, "packages/a/package.json"), "utf8")
    ).toContain('"1.0.0"');
  });

  test("refuses a dirty working tree", () => {
    const dir = repo();
    writeFileSync(join(dir, "stray.txt"), "x");
    expect(() => release(dir, "1.0.0", "2026-10-01")).toThrow("not clean");
  });

  test("refuses a tag that already exists", () => {
    const dir = repo();
    git(dir, "tag", "v1.0.0");
    expect(() => release(dir, "1.0.0", "2026-10-01")).toThrow("already exists");
  });

  test("refuses a changelog with no Unreleased section", () => {
    const dir = repo();
    writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n");
    git(dir, "commit", "-q", "-am", "drop unreleased");
    expect(() => release(dir, "1.0.0", "2026-10-01")).toThrow("Unreleased");
  });
});
