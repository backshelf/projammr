import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { commits } from "../../db/schema/repos.js";
import { saves } from "../../db/schema/saves.js";
import {
  adoptNewSet,
  commitPayload,
  hashOf,
  objectsOf,
  pushCommits,
  pushSaves,
  pushSegments,
  savePayload,
  trackSeeds,
} from "../../test/dit-history.js";
import { setupSuite } from "../../test/fixtures.js";
import {
  callTool,
  ensureMcpServerListening,
  mintMcpToken,
} from "../../test/mcp.js";

const suite = setupSuite("MCP repo tools");
const { owner, outsider } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);

const T0 = Date.UTC(2026, 5, 1);
const MINUTE = 60_000;

type ToolResult = {
  result: {
    isError?: boolean;
    content: { text: string }[];
    structuredContent: unknown;
  };
};

const contentOf = <T>(body: unknown) =>
  (body as ToolResult).result.structuredContent as T;

async function saveOf(sessionId: number, hash: string) {
  const [row] = await db
    .select({ id: saves.id })
    .from(saves)
    .where(and(eq(saves.sessionId, sessionId), eq(saves.hash, hash)));
  return row;
}

/** A set with two commits on `main` and one on `side`, returning the repo, session and the first commit's id. */
async function seedHistory(label: string) {
  const set = await adoptNewSet(suite, label);
  const first = savePayload(`${label}-1`, T0);
  const second = savePayload(`${label}-2`, T0 + MINUTE, {
    meta: {
      tempo: "128",
      timeSignature: "4/4",
      rootNote: null,
      scale: null,
      tracksCount: 3,
      scenesCount: 1,
      dawVersion: "12.1",
      structure: null,
      samplePaths: ["a.wav"],
    },
  });
  const other = savePayload(`${label}-3`, T0 + 2 * MINUTE);
  await seedObjects(set.repoId, owner.userId, [
    ...objectsOf(first),
    ...objectsOf(second),
    ...objectsOf(other),
  ]);
  await pushSaves(suite, set, "main", [first, second]);
  await pushSaves(suite, set, "side", [other]);
  const c1 = commitPayload(`${label}-c1`, null, [first]);
  const c2 = commitPayload(`${label}-c2`, c1.hash, [second]);
  await pushCommits(suite, set, "main", [c1, c2]);
  await pushCommits(suite, set, "side", [
    commitPayload(`${label}-c3`, null, [other]),
  ]);
  const [row] = await db
    .select({ id: commits.id })
    .from(commits)
    .where(eq(commits.hash, c1.hash));
  return { set, c1, c2, firstCommitId: row!.id, second };
}

describe("repo tools over /api/mcp", () => {
  beforeAll(ensureMcpServerListening);

  it("list_repos answers a project's repos with their sets", async () => {
    suite.requireProject();
    const { set } = await seedHistory("List repos");
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "list_repos", {
      projectId: suite.projectId,
    });
    const { repos } = contentOf<{
      repos: { id: number; sets: unknown[] }[];
    }>(body);
    const repo = repos.find((r) => r.id === set.repoId);
    expect(repo!.sets).toMatchObject([
      {
        ditSetId: set.ditSetId,
        sessionId: set.sessionId,
        sessionName: "List repos",
        branches: [
          { name: "main", tip: { message: expect.any(String) } },
          { name: "side", tip: { message: expect.any(String) } },
        ],
      },
    ]);
  });

  it("list_commits answers a session's commits newest first with their saves", async () => {
    suite.requireProject();
    const { set, c1, c2 } = await seedHistory("List commits");
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "list_commits", {
      sessionId: set.sessionId,
    });
    const { commits: listed } = contentOf<{
      commits: { hash: string; saves: unknown[] }[];
    }>(body);
    expect(listed.map((c) => c.hash)).toContain(c1.hash);
    expect(listed[0]!.hash).not.toBe(c1.hash);
    expect(listed.find((c) => c.hash === c2.hash)!.saves).toHaveLength(1);
  });

  it("list_commits and get_commit carry each commit's timeInSet", async () => {
    suite.requireProject();
    const { set, c1, c2 } = await seedHistory("Time in set");
    await pushSegments(suite, set, [
      {
        branch: "main",
        machineName: "studio",
        startedAt: T0 - 2 * MINUTE,
        endedAt: T0 + 30_000,
        source: "script",
      },
    ]);
    const token = await mintMcpToken(owner, ["read"]);
    const listed = await callTool(token, "list_commits", {
      sessionId: set.sessionId,
    });
    const { commits: rows } = contentOf<{
      commits: { id: number; hash: string; timeInSet: number | null }[];
    }>(listed.body);
    expect(rows.find((c) => c.hash === c1.hash)!.timeInSet).toBe(120);
    const second = rows.find((c) => c.hash === c2.hash)!;
    expect(second.timeInSet).toBe(30);

    const { body } = await callTool(token, "get_commit", { id: second.id });
    expect(contentOf<{ timeInSet: number | null }>(body).timeInSet).toBe(30);

    const session = await callTool(token, "get_session", {
      id: set.sessionId,
    });
    expect(
      contentOf<{ history: { timeInSet: number } }>(session.body).history
        .timeInSet
    ).toBe(150);
  });

  it("list_commits keeps one branch's commits and answers none for an unknown branch", async () => {
    suite.requireProject();
    const { set, c1, c2 } = await seedHistory("Branch filter");
    const token = await mintMcpToken(owner, ["read"]);
    const hashesOn = async (branch: string) => {
      const { body } = await callTool(token, "list_commits", {
        sessionId: set.sessionId,
        branch,
      });
      return contentOf<{ commits: { hash: string }[] }>(body).commits.map(
        (c) => c.hash
      );
    };
    expect(await hashesOn("main")).toEqual([c2.hash, c1.hash]);
    expect(await hashesOn("side")).toHaveLength(1);
    expect(await hashesOn("nope")).toEqual([]);
  });

  it("list_commits keeps the commits after `since`", async () => {
    suite.requireProject();
    const { set, c2 } = await seedHistory("Since filter");
    const token = await mintMcpToken(owner, ["read"]);
    const hashesSince = async (since: string) => {
      const { body } = await callTool(token, "list_commits", {
        sessionId: set.sessionId,
        since,
      });
      return contentOf<{ commits: { hash: string }[] }>(body).commits.map(
        (c) => c.hash
      );
    };
    // c1 is committed at T0 + 1, c2 at T0 + MINUTE + 1, the side commit later still.
    const afterFirst = new Date(T0 + 1).toISOString();
    const hashes = await hashesSince(afterFirst);
    expect(hashes).toHaveLength(2);
    expect(hashes).toContain(c2.hash);
    expect(await hashesSince(new Date(T0 + 10 * MINUTE).toISOString())).toEqual(
      []
    );
  });

  it("diff_commits compares two states across branches and refuses a state of another session", async () => {
    suite.requireProject();
    const meta = (tempo: string, samplePaths: string[]) => ({
      tempo,
      timeSignature: "4/4",
      rootNote: null,
      scale: null,
      tracksCount: 1,
      scenesCount: 0,
      dawVersion: null,
      structure: null,
      samplePaths,
    });
    const set = await adoptNewSet(suite, "Diff tool");
    const a = savePayload("diff-a", T0, { meta: meta("120", []) });
    const b = savePayload("diff-b", T0 + MINUTE, {
      meta: meta("128", ["kick.wav"]),
    });
    await seedObjects(set.repoId, owner.userId, [a, b].flatMap(objectsOf));
    await pushSaves(suite, set, "main", [a]);
    await pushSaves(suite, set, "idea", [b]);
    const ca = commitPayload("diff-ca", null, [a]);
    await pushCommits(suite, set, "main", [ca]);
    const [commitA] = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.hash, ca.hash));
    const saveB = await saveOf(set.sessionId, b.hash);
    const otherSet = await adoptNewSet(suite, "Diff tool other");
    await pushSaves(suite, otherSet, "main", [
      savePayload("diff-foreign", T0, { meta: meta("90", []) }),
    ]);
    const foreignSave = await saveOf(
      otherSet.sessionId,
      hashOf("save-diff-foreign")
    );

    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "diff_commits", {
      sessionId: set.sessionId,
      from: `commit:${commitA!.id}`,
      to: `save:${saveB!.id}`,
    });
    const diff = contentOf<{
      from: number;
      to: number;
      changed: boolean;
      chips: { label: string }[];
      samples: { added: string[] };
    }>(body);
    expect(diff.to).toBe(saveB!.id);
    expect(diff.changed).toBe(true);
    expect(diff.chips.map((chip) => chip.label)).toContain("tempo 120 → 128");
    expect(diff.samples.added).toEqual(["kick.wav"]);

    const refused = await callTool(token, "diff_commits", {
      sessionId: set.sessionId,
      from: `commit:${commitA!.id}`,
      to: `save:${foreignSave!.id}`,
    });
    expect((refused.body as ToolResult).result.isError).toBe(true);
  });

  it("get_commit answers one commit with the saves it covers and their meta", async () => {
    suite.requireProject();
    const { set, c2, firstCommitId, second } = await seedHistory("Get commit");
    const token = await mintMcpToken(owner, ["read"]);
    // The id comes from list_commits, the way an agent reaches a commit.
    const listed = await callTool(token, "list_commits", {
      sessionId: set.sessionId,
    });
    const row = contentOf<{ commits: { id: number; hash: string }[] }>(
      listed.body
    ).commits.find((c) => c.hash === c2.hash);
    const { body } = await callTool(token, "get_commit", { id: row!.id });
    const commit = contentOf<{ saves: { meta: unknown }[] }>(body);
    expect(commit).toMatchObject({
      hash: c2.hash,
      branch: "main",
      saveHash: second.hash,
    });
    expect(commit.saves).toHaveLength(1);
    expect(commit.saves[0]!.meta).toMatchObject({ tempo: "128" });

    const missing = await callTool(token, "get_commit", {
      id: firstCommitId + 1_000_000,
    });
    expect((missing.body as ToolResult).result.isError).toBe(true);
    expect((missing.body as ToolResult).result.content[0]?.text).toContain(
      "commit not found"
    );
  });

  it("answers not found to a caller outside the project from every tool", async () => {
    suite.requireProject();
    const { set, firstCommitId } = await seedHistory("Outsider");
    const token = await mintMcpToken(outsider, ["read"]);
    const calls: [string, Record<string, unknown>, string][] = [
      ["list_repos", { projectId: suite.projectId }, "project not found"],
      ["list_commits", { sessionId: set.sessionId }, "session not found"],
      ["get_commit", { id: firstCommitId }, "commit not found"],
      [
        "diff_commits",
        { sessionId: set.sessionId, from: "save:1", to: "save:2" },
        "session not found",
      ],
    ];
    for (const [name, input, message] of calls) {
      const { body } = await callTool(token, name, input);
      const { result } = body as ToolResult;
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(message);
    }
  });
});
