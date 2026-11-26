import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, setManifestVersion, syncVersion } from "./sync-version";

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(-rc\.\d+)?$/;
const UNRELEASED_HEADING = /^## \[Unreleased\][ \t]*$/m;
const UNRELEASED_LINK =
  /^\[Unreleased\]: (.*)\/compare\/(v[^.\s]+\.[^.\s]+\.[^.\s]+(?:-rc\.\d+)?)\.\.\.HEAD[ \t]*$/im;

/** The argument as a release version, or an error message naming what is wrong with it. */
export function parseReleaseVersion(
  arg: string | undefined
): { version: string } | { error: string } {
  if (arg && VERSION_PATTERN.test(arg)) return { version: arg };
  return { error: "Usage: bun run release <x.y.z | x.y.z-rc.N>" };
}

/** The start of a release's changelog heading, up to its date: `## [1.0.0] - `. */
export function releaseHeadingPrefix(version: string): string {
  return `## [${version}] - `;
}

export function hasUnreleasedSection(changelog: string): boolean {
  return UNRELEASED_HEADING.test(changelog);
}

/**
 * Turns the Unreleased section into the release's section, dated `date`, and puts a fresh empty
 * Unreleased above it. A trailing `[Unreleased]: …/compare/vPREV...HEAD` link is moved on to the new
 * tag and gains a `[version]` link comparing the previous tag with the new one.
 */
export function rewriteChangelog(
  changelog: string,
  version: string,
  date: string
): string {
  const heading = `${releaseHeadingPrefix(version)}${date}`;
  let next = changelog.replace(
    UNRELEASED_HEADING,
    `## [Unreleased]\n\n${heading}`
  );
  const link = UNRELEASED_LINK.exec(next);
  if (link) {
    const [line, base, previous] = link;
    next = next.replace(
      line,
      `[Unreleased]: ${base}/compare/v${version}...HEAD\n[${version}]: ${base}/compare/${previous}...v${version}`
    );
  }
  return next;
}

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`
    );
  }
  return result.stdout.toString();
}

/** Runs the release in `root`: bump, sync, changelog, one commit, one annotated tag. Never pushes. */
export function release(root: string, version: string, date: string): void {
  const tag = `v${version}`;
  if (git(root, "status", "--porcelain").trim() !== "") {
    throw new Error("The working tree is not clean; commit or stash first.");
  }
  if (git(root, "tag", "--list", tag).trim() !== "") {
    throw new Error(`The tag ${tag} already exists.`);
  }
  const changelogPath = join(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  if (!hasUnreleasedSection(changelog)) {
    throw new Error("CHANGELOG.md has no `## [Unreleased]` section.");
  }

  const rootManifest = join(root, "package.json");
  writeFileSync(
    rootManifest,
    setManifestVersion(readFileSync(rootManifest, "utf8"), version)
  );
  const synced = syncVersion(root);
  writeFileSync(changelogPath, rewriteChangelog(changelog, version, date));

  git(root, "add", "--", "package.json", "CHANGELOG.md", ...synced);
  git(root, "commit", "-m", `chore(release): ${version}`);
  git(root, "tag", "-a", tag, "-m", `Projammr ${version}`);
}

if (import.meta.main) {
  const parsed = parseReleaseVersion(process.argv[2]);
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }
  try {
    release(REPO_ROOT, parsed.version, new Date().toISOString().slice(0, 10));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  console.log(
    `Released ${parsed.version}. Push it with:\n  git push origin HEAD v${parsed.version}`
  );
}
