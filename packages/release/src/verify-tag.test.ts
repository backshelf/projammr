import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changelogSection, verifyTag } from "./verify-tag";

const changelog = `# Changelog

## [Unreleased]

- Not yet.

## [1.0.0] - 2026-10-01

### Added

- Something.
- Another thing.

## [1.0.0-rc.1] - 2026-09-20

- A candidate.

## [0.9.0] - 2026-01-01

- Older.

[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/o/r/compare/v0.9.0...v1.0.0
`;

describe("changelogSection", () => {
  test("is the text between the heading and the next one", () => {
    expect(changelogSection(changelog, "1.0.0")).toBe(
      "### Added\n\n- Something.\n- Another thing."
    );
  });

  test("does not take a longer version for a prefix of it", () => {
    expect(changelogSection(changelog, "1.0.0-rc.1")).toBe("- A candidate.");
  });

  test("stops at the trailing link references of the last section", () => {
    expect(changelogSection(changelog, "0.9.0")).toBe("- Older.");
    const last = "## [1.0.0] - 2026-10-01\n\n- Only.\n\n[1.0.0]: https://x/y\n";
    expect(changelogSection(last, "1.0.0")).toBe("- Only.");
  });

  test("is null when the version has no section", () => {
    expect(changelogSection(changelog, "2.0.0")).toBeNull();
    expect(changelogSection(changelog, "Unreleased")).toBeNull();
  });

  test("handles CRLF line endings", () => {
    expect(changelogSection(changelog.replaceAll("\n", "\r\n"), "1.0.0")).toBe(
      "### Added\n\n- Something.\n- Another thing."
    );
  });
});

describe("verifyTag", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  function root(version: string, text = changelog): string {
    const dir = mkdtempSync(join(tmpdir(), "verify-tag-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      `{\n  "name": "root",\n  "version": "${version}"\n}\n`
    );
    writeFileSync(join(dir, "CHANGELOG.md"), text);
    return dir;
  }

  test("accepts a tag that names the root version and has a section", () => {
    expect(verifyTag(root("1.0.0"), "v1.0.0")).toEqual({
      version: "1.0.0",
      prerelease: false,
      notes: "### Added\n\n- Something.\n- Another thing.",
    });
  });

  test("marks a release candidate as a pre-release", () => {
    const check = verifyTag(root("1.0.0-rc.1"), "v1.0.0-rc.1");
    expect(check.prerelease).toBe(true);
    expect(check.notes).toBe("- A candidate.");
  });

  test.each(["1.0.0", "v1.0", "v1.0.0-beta.1", "vv1.0.0", "v"])(
    "refuses the malformed tag %p",
    (tag) => {
      expect(() => verifyTag(root("1.0.0"), tag)).toThrow("is not v<x.y.z");
    }
  );

  test("refuses a tag that is not the root version", () => {
    expect(() => verifyTag(root("1.0.0"), "v0.9.0")).toThrow(
      "does not match the version 1.0.0"
    );
  });

  test("refuses a version with no changelog section", () => {
    expect(() => verifyTag(root("2.0.0"), "v2.0.0")).toThrow(
      "has no `## [2.0.0] - ` section"
    );
  });

  test("refuses an empty section", () => {
    const empty =
      "## [1.0.0] - 2026-10-01\n\n## [0.9.0] - 2026-01-01\n\n- Old.\n";
    expect(() => verifyTag(root("1.0.0", empty), "v1.0.0")).toThrow("is empty");
  });
});
