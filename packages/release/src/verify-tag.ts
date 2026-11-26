import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION_PATTERN, releaseHeadingPrefix } from "./release";
import { REPO_ROOT, readRootVersion } from "./sync-version";

const LINK_REFERENCE = /^\[[^\]]+\]: /;

export interface VerifiedTag {
  version: string;
  /** An `-rc.N` version: published as a pre-release, never promoted to `latest`. */
  prerelease: boolean;
  /** The release's changelog section without its heading: the release body. */
  notes: string;
}

/**
 * The body of `version`'s `## [version] - date` section: from the heading to the next `## ` heading
 * or the changelog's trailing link references, trimmed. Null when there is no such section.
 */
export function changelogSection(
  changelog: string,
  version: string
): string | null {
  const lines = changelog.split("\n");
  const prefix = releaseHeadingPrefix(version);
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ") || LINK_REFERENCE.test(line)) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

/**
 * Checks that the pushed tag names the version every manifest carries and that the changelog has a
 * section with something in it for that version. Throws a message naming what is wrong.
 */
export function verifyTag(root: string, tag: string): VerifiedTag {
  if (!tag.startsWith("v") || !VERSION_PATTERN.test(tag.slice(1))) {
    throw new Error(`The tag ${tag} is not v<x.y.z> or v<x.y.z-rc.N>.`);
  }
  const version = tag.slice(1);
  const rootVersion = readRootVersion(root);
  if (version !== rootVersion) {
    throw new Error(
      `The tag ${tag} does not match the version ${rootVersion} in package.json.`
    );
  }
  const notes = changelogSection(
    readFileSync(join(root, "CHANGELOG.md"), "utf8"),
    version
  );
  if (notes === null) {
    throw new Error(
      `CHANGELOG.md has no \`${releaseHeadingPrefix(version)}\` section.`
    );
  }
  if (notes === "") {
    throw new Error(`The changelog section for ${version} is empty.`);
  }
  return { version, prerelease: version.includes("-rc."), notes };
}

if (import.meta.main) {
  const [tag, notesPath] = process.argv.slice(2);
  if (!tag || !notesPath) {
    console.error("Usage: bun verify-tag.ts <tag> <notes-file>");
    process.exit(1);
  }
  try {
    const { version, prerelease, notes } = verifyTag(REPO_ROOT, tag);
    writeFileSync(notesPath, `${notes}\n`);
    // `version=…` and `prerelease=…` lines, which a workflow step appends to its output file.
    process.stdout.write(`version=${version}\nprerelease=${prerelease}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
