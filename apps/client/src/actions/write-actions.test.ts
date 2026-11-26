import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

/**
 * A write that does not refresh leaves its caller to do it, which costs a
 * second round trip and is forgotten in places. `written()` makes the refresh
 * part of the action's own response, and this test is what keeps the next
 * write from being written without it.
 *
 * The check reads the sources as text rather than importing them: every module
 * here starts with `"use server"`, and the ones that matter reach for
 * `server-only` helpers a test runner cannot load.
 */

/** Why a write deliberately does not refresh the route it ran on. */
const UNREFRESHED: Record<string, string> = {
  createProject: "the caller navigates to the new project",
  deleteProject: "the caller navigates away from the deleted project",
  deleteNote: "the caller navigates away from the deleted note",
  acceptInvite: "the caller navigates to the project it joined",
  leaveProject:
    "it redirects home itself; a refresh would re-render the left project as not-found",
  patchEntity:
    "save-description.ts autosaves through it on a 1.5s debounce; refreshing " +
    "would re-render the page under the cursor. patchField wraps it instead.",
};

/**
 * A write reaches the API either directly or through the entity registry, and
 * both have to count: `patch-field.ts` names no HTTP verb of its own, so a
 * registry-only match is the difference between this sweep covering the
 * entity writes and silently skipping them.
 */
const WRITE = /serverApi\.(POST|PUT|PATCH|DELETE)\b|\bENTITY_API[.[]/;

/**
 * Every exported top-level function, with its body. Prettier closes a
 * top-level declaration at column 0, so the next `}` or `};` there ends one.
 */
const functions = (source: string) => {
  const lines = source.split("\n");
  const found: { name: string; body: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const declaration = lines[i]!.match(
      /^export (?:async function|const|function) (\w+)/
    );
    if (!declaration) continue;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\};?$/.test(lines[j]!)) {
        end = j;
        break;
      }
    }
    found.push({
      name: declaration[1]!,
      body: lines.slice(i, end + 1).join("\n"),
    });
    i = end;
  }
  return found;
};

const actions = async () => {
  const directory = import.meta.dir;
  const found: { file: string; name: string; body: string }[] = [];
  for await (const file of new Glob("*.ts").scan(directory)) {
    if (file.endsWith(".test.ts")) continue;
    const source = await Bun.file(`${directory}/${file}`).text();
    for (const fn of functions(source)) found.push({ file, ...fn });
  }
  return found;
};

describe("write actions", () => {
  it("every write action refreshes or is allow-listed", async () => {
    const unwrapped = (await actions())
      .filter((fn) => WRITE.test(fn.body))
      .filter(
        (fn) => !fn.body.includes("written(") && !(fn.name in UNREFRESHED)
      )
      .map((fn) => `${fn.file}: ${fn.name}`);

    expect(unwrapped).toEqual([]);
  });

  it("the allow-list names only functions that exist", async () => {
    const writes = new Set(
      (await actions()).filter((fn) => WRITE.test(fn.body)).map((fn) => fn.name)
    );
    const stale = Object.keys(UNREFRESHED).filter((name) => !writes.has(name));

    expect(stale).toEqual([]);
  });
});
