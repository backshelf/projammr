import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../../db/index.js";
import { machines } from "../../db/schema/machines.js";
import { repos } from "../../db/schema/repos.js";
import { adoptNewSet, pushSaves, savePayload } from "../../test/dit-history.js";
import { setupSuite } from "../../test/fixtures.js";
import {
  callTool,
  ensureMcpServerListening,
  mintMcpToken,
} from "../../test/mcp.js";

const suite = setupSuite("MCP machine tools");
const { owner, editor, outsider } = suite;

type ListedMachine = {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  online: boolean;
  openSession: { id: number; name: string; projectId: number } | null;
  pushedRepos: { id: number; name: string; projectId: number }[];
};

type ToolResult = {
  result: { isError?: boolean; structuredContent: unknown };
};

const contentOf = <T>(body: unknown) =>
  (body as ToolResult).result.structuredContent as T;

const MINUTE = 60_000;

/** Seeds a machine row for `userId`, last seen `ageMs` ago. */
async function seedMachine(
  userId: string,
  overrides: {
    name?: string;
    ageMs?: number;
    openSessionId?: number | null;
    repoIds?: number[];
  } = {}
): Promise<string> {
  const id = randomUUID();
  await db.insert(machines).values({
    id,
    userId,
    name: overrides.name ?? `Machine ${id}`,
    platform: "macOS",
    appVersion: "0.14.0",
    lastSeenAt: new Date(Date.now() - (overrides.ageMs ?? 0)),
    openSessionId: overrides.openSessionId ?? null,
    repoIds: overrides.repoIds ?? [],
  });
  return id;
}

async function repoIn(projectId: number): Promise<number> {
  const [row] = await db
    .insert(repos)
    .values({
      projectId,
      name: `Repo ${randomUUID()}`,
      createdBy: owner.userId,
    })
    .returning({ id: repos.id });
  return row!.id;
}

async function listMachines(
  token: string,
  input: Record<string, unknown> = {}
): Promise<ListedMachine[]> {
  const { body } = await callTool(token, "list_machines", input);
  return contentOf<{ machines: ListedMachine[] }>(body).machines;
}

beforeAll(ensureMcpServerListening);

afterAll(async () => {
  await db.delete(machines).where(eq(machines.userId, owner.userId));
});

describe("list_machines", () => {
  it("lists the caller's machines with online state and no open session when offline", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const online = await seedMachine(owner.userId, {
      name: "MCP online",
      openSessionId: session.id,
    });
    const offline = await seedMachine(owner.userId, {
      name: "MCP offline",
      ageMs: 2 * MINUTE,
      openSessionId: session.id,
    });
    await seedMachine(editor.userId, { name: "MCP editor" });

    const token = await mintMcpToken(owner, ["read"]);
    const listed = await listMachines(token);

    const byId = new Map(listed.map((m) => [m.id, m]));
    expect(byId.get(online)).toMatchObject({
      name: "MCP online",
      platform: "macOS",
      appVersion: "0.14.0",
      online: true,
      openSession: {
        id: session.id,
        name: session.name,
        projectId: suite.projectId,
      },
      pushedRepos: [],
    });
    expect(byId.get(offline)).toMatchObject({
      online: false,
      openSession: null,
    });
    expect(listed.some((m) => m.name === "MCP editor")).toBe(false);
  });

  it("lists the repos a machine has pushed to", async () => {
    suite.requireProject();
    const name = `MCP pusher ${randomUUID().slice(0, 8)}`;
    const id = await seedMachine(owner.userId, { name });
    const set = await adoptNewSet(suite, "MCP pushed");
    const pushed = await pushSaves(
      suite,
      set,
      "main",
      [savePayload("mcp-pushed", Date.UTC(2026, 5, 1), { machineName: name })],
      "owner",
      id
    );
    expect(pushed.status).toBe(200);

    const token = await mintMcpToken(owner, ["read"]);
    const listed = await listMachines(token);

    expect(listed.find((m) => m.id === id)?.pushedRepos).toEqual([
      { id: set.repoId, name: "MCP pushed", projectId: suite.projectId },
    ]);
  });

  it("keeps only the machines tracking a repo of the given project", async () => {
    suite.requireProject();
    const repoId = await repoIn(suite.projectId);
    const tracking = await seedMachine(owner.userId, {
      name: "MCP tracking",
      repoIds: [repoId],
    });
    const other = await seedMachine(owner.userId, {
      name: "MCP untracked",
      repoIds: [],
    });

    const token = await mintMcpToken(owner, ["read"]);
    const listed = await listMachines(token, { projectId: suite.projectId });
    const ids = listed.map((m) => m.id);
    expect(ids).toContain(tracking);
    expect(ids).not.toContain(other);
  });

  it("answers 404 project not found for a project the caller cannot read", async () => {
    suite.requireProject();
    const token = await mintMcpToken(outsider, ["read"]);
    const { body } = await callTool(token, "list_machines", {
      projectId: suite.projectId,
    });
    expect((body as ToolResult).result.isError).toBe(true);
    expect(JSON.stringify(body)).toContain("project not found");
  });
});
