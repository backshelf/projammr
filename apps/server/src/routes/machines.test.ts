import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { authSessions } from "../db/schema/auth.js";
import { machines } from "../db/schema/machines.js";
import { members } from "../db/schema/projects.js";
import { users } from "../db/schema/auth.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  savePayload,
  trackSeeds,
} from "../test/dit-history.js";
import {
  type Actor,
  baseUrl,
  setupSuite,
  signInAgain,
} from "../test/fixtures.js";

const suite = setupSuite("Machines");
const { owner, editor, outsider, requestAs } = suite;

type Beat = {
  name: string;
  platform: string;
  appVersion: string;
  openSessionId: number | null;
  repoIds: number[];
};

const beat = (overrides: Partial<Beat> = {}): Beat => ({
  name: `Studio Mac ${randomUUID()}`,
  platform: "macOS",
  appVersion: "0.14.0",
  openSessionId: null,
  repoIds: [],
  ...overrides,
});

const send = (actor: Actor, method: string, path: string, body?: unknown) =>
  requestAs(actor, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const putMachine = (actor: Actor, id: string, body: Beat = beat()) =>
  send(actor, "PUT", `/machines/${id}`, body);

/**
 * A machine the actor owns, registered by its first beat from a sign-in of its
 * own, as the app's is: removing the machine ends that sign-in, not the
 * actor's.
 */
async function mkMachine(actor: Actor, overrides: Partial<Beat> = {}) {
  const id = randomUUID();
  const res = await putMachine(await signInAgain(actor), id, beat(overrides));
  expect(res.status).toBe(200);
  return id;
}

/** Backdates a machine's last beat past the 90 s online window. */
async function goOffline(id: string) {
  await db
    .update(machines)
    .set({ lastSeenAt: new Date(Date.now() - 120_000) })
    .where(eq(machines.id, id));
}

type ListedMachine = {
  id: string;
  name: string;
  online: boolean;
  openSessionId: number | null;
  repoIds: number[];
};

async function listMachines(actor: Actor): Promise<ListedMachine[]> {
  const res = await send(actor, "GET", "/machines");
  expect(res.status).toBe(200);
  return (await res.json()).machines;
}

type Presence = {
  id: string;
  name: string;
  tracksRepo: boolean;
  openingThis: boolean;
};

async function presenceOf(
  actor: Actor,
  sessionId: number
): Promise<Presence[]> {
  const res = await send(actor, "GET", `/sessions/${sessionId}/presence`);
  expect(res.status).toBe(200);
  return (await res.json()).machines;
}

describe("PUT /machines/:id", () => {
  it("registers on the first beat and updates on the next", async () => {
    suite.requireProject();
    const id = randomUUID();

    const first = await putMachine(owner, id, beat({ name: "First" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      id,
      name: "First",
      platform: "macOS",
      appVersion: "0.14.0",
      online: true,
      openSessionId: null,
    });

    const second = await putMachine(owner, id, beat({ name: "Renamed" }));
    expect(second.status).toBe(200);
    expect((await second.json()).name).toBe("Renamed");
    expect((await listMachines(owner)).filter((m) => m.id === id)).toHaveLength(
      1
    );
  });

  it.each([
    ["a name of 70 characters", "m".repeat(70), "m".repeat(64)],
    ["33 astral characters", "😀".repeat(33), "😀".repeat(32)],
    ["a pair straddling the limit", `${"m".repeat(63)}😀b`, "m".repeat(63)],
  ])(
    "cuts %s to at most 64 UTF-16 units without splitting a pair",
    async (_label, name, expected) => {
      suite.requireProject();
      const id = randomUUID();

      const res = await putMachine(owner, id, beat({ name: ` ${name} ` }));

      expect(res.status).toBe(200);
      const [row] = await db.select().from(machines).where(eq(machines.id, id));
      expect(row?.name).toBe(expected);
      expect(row!.name.length).toBeLessThanOrEqual(64);
      expect(row!.name).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      );
    }
  );

  it("refuses another account's machine id with 403 and leaves its row alone", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "Owned" });

    const res = await putMachine(editor, id, beat({ name: "Taken" }));
    expect(res.status).toBe(403);

    const [row] = await db.select().from(machines).where(eq(machines.id, id));
    expect(row?.name).toBe("Owned");
    expect(row?.userId).toBe(owner.userId);
  });

  it("answers 409 machine_name_taken when another of the caller's machines holds the name", async () => {
    suite.requireProject();
    await mkMachine(owner, { name: "Clash" });

    const res = await putMachine(owner, randomUUID(), beat({ name: "Clash" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("machine_name_taken");
  });

  it("lets two accounts each hold the same name", async () => {
    suite.requireProject();
    await mkMachine(owner, { name: "Shared name" });

    const res = await putMachine(
      editor,
      randomUUID(),
      beat({ name: "Shared name" })
    );
    expect(res.status).toBe(200);
  });

  it("stores a null open session when the caller cannot read the session", async () => {
    suite.requireProject();
    const throwaway = await suite.throwawayProject("Unreadable");
    const hidden = await suite.mkSession(
      { projectId: throwaway.id },
      throwaway.owner.cookie
    );

    const id = randomUUID();
    const res = await putMachine(owner, id, beat({ openSessionId: hidden.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).openSessionId).toBeNull();

    const [row] = await db.select().from(machines).where(eq(machines.id, id));
    expect(row?.openSessionId).toBeNull();
  });

  it("keeps the open session when the caller is a member of its project", async () => {
    suite.requireProject();
    const session = await suite.mkSession();

    const id = randomUUID();
    const res = await putMachine(
      owner,
      id,
      beat({ openSessionId: session.id })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).openSessionId).toBe(session.id);
  });

  it("drops the open session when the caller is not a member of its project", async () => {
    suite.requireProject();
    const session = await suite.mkSession();

    // The outsider is in no project of the session: the open session is dropped.
    const res = await putMachine(
      outsider,
      randomUUID(),
      beat({ openSessionId: session.id })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).openSessionId).toBeNull();
  });
});

describe("GET /machines", () => {
  it("lists only the caller's machines with their repo ids and online state", async () => {
    suite.requireProject();
    const mine = await mkMachine(owner, { name: "Listed", repoIds: [3, 7] });
    const offline = await mkMachine(owner, { name: "Listed offline" });
    await goOffline(offline);
    const theirs = await mkMachine(editor, { name: "Not mine" });

    const listed = await listMachines(owner);
    const ids = listed.map((m) => m.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(offline);
    expect(ids).not.toContain(theirs);

    expect(listed.find((m) => m.id === mine)).toMatchObject({
      online: true,
      repoIds: [3, 7],
    });
    expect(listed.find((m) => m.id === offline)?.online).toBe(false);
  });
});

describe("DELETE /machines/:id", () => {
  it("removes the caller's machine with 204, then 404s the same id", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "To remove" });

    const res = await send(owner, "DELETE", `/machines/${id}`);
    expect(res.status).toBe(204);

    const again = await send(owner, "DELETE", `/machines/${id}`);
    expect(again.status).toBe(404);
  });

  it("refuses another account's machine with 403 and keeps it", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "Keep me" });

    const res = await send(editor, "DELETE", `/machines/${id}`);
    expect(res.status).toBe(403);

    const [row] = await db.select().from(machines).where(eq(machines.id, id));
    expect(row).toBeDefined();
  });

  it("frees the name for a new registration once removed", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "Reusable" });
    await send(owner, "DELETE", `/machines/${id}`);

    const res = await putMachine(
      owner,
      randomUUID(),
      beat({ name: "Reusable" })
    );
    expect(res.status).toBe(200);
  });

  it("keeps the row, marked removed, under its last name and lists it nowhere", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "Kept row" });

    expect((await send(owner, "DELETE", `/machines/${id}`)).status).toBe(204);

    const [row] = await db.select().from(machines).where(eq(machines.id, id));
    expect(row?.removedAt).not.toBeNull();
    expect(row?.name).toBe("Kept row");
    expect((await listMachines(owner)).map((m) => m.id)).not.toContain(id);
  });

  it("revokes the sign-in the machine's last beat came from, so its next request is a 401", async () => {
    suite.requireProject();
    const dit = await signInAgain(owner);
    const id = randomUUID();
    const bearer = {
      Authorization: `Bearer ${dit.token}`,
      "Content-Type": "application/json",
    };
    const beatAsBearer = () =>
      app.request(`${baseUrl}/machines/${id}`, {
        method: "PUT",
        headers: bearer,
        body: JSON.stringify(beat()),
      });
    expect((await beatAsBearer()).status).toBe(200);
    const [session] = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.token, dit.token));
    const [registered] = await db
      .select()
      .from(machines)
      .where(eq(machines.id, id));
    expect(registered?.authSessionId).toBe(session!.id);

    expect((await send(owner, "DELETE", `/machines/${id}`)).status).toBe(204);

    // A bearer-only caller, as dit is, sends no Better Auth cookie cache, so
    // the deleted session refuses its very next request.
    expect((await beatAsBearer()).status).toBe(401);
    expect((await send(dit, "GET", "/machines")).status).toBe(401);
    expect((await send(owner, "GET", "/machines")).status).toBe(200);
  });

  it("answers a beat from a removed id with 401 even on a live sign-in, and keeps it removed", async () => {
    suite.requireProject();
    const id = await mkMachine(owner, { name: "Gone for good" });
    await send(owner, "DELETE", `/machines/${id}`);

    const res = await putMachine(owner, id, beat({ name: "Gone for good" }));

    expect(res.status).toBe(401);
    const [row] = await db.select().from(machines).where(eq(machines.id, id));
    expect(row?.removedAt).not.toBeNull();
  });
});

describe("GET /sessions/:id/presence", () => {
  it("lists the caller's online machines, opening this session first then tracking its repo then newest", async () => {
    suite.requireProject();
    const set = await adoptNewSet(suite, "presence-order");
    const { sessionId, repoId } = set;

    const opening = await mkMachine(owner, {
      name: "Opening",
      openSessionId: sessionId,
      repoIds: [repoId],
    });
    const tracking = await mkMachine(owner, {
      name: "Tracking",
      repoIds: [repoId],
    });
    const idle = await mkMachine(owner, { name: "Idle" });
    const gone = await mkMachine(owner, {
      name: "Gone",
      openSessionId: sessionId,
      repoIds: [repoId],
    });
    await goOffline(gone);
    await mkMachine(editor, {
      name: "Editor's",
      openSessionId: sessionId,
      repoIds: [repoId],
    });

    const presence = await presenceOf(owner, sessionId);
    const ids = presence.map((m) => m.id);
    expect(ids).not.toContain(gone);
    // Other online machines of the caller may appear too; these three are
    // ordered by opening, then tracking, then recency.
    const created: string[] = [opening, tracking, idle];
    const ours = presence.filter((m) => created.includes(m.id));
    expect(ours.map((m) => m.id)).toEqual([opening, tracking, idle]);
    expect(ours[0]).toMatchObject({ openingThis: true, tracksRepo: true });
    expect(ours[1]).toMatchObject({ openingThis: false, tracksRepo: true });
    expect(ours[2]).toMatchObject({ openingThis: false, tracksRepo: false });
  });

  it("shows an editor only the editor's own machines on the session", async () => {
    suite.requireProject();
    const set = await adoptNewSet(suite, "presence-own");
    const mine = await mkMachine(editor, {
      name: "Editor only",
      repoIds: [set.repoId],
    });
    const theirs = await mkMachine(owner, {
      name: "Owner only",
      repoIds: [set.repoId],
    });

    const presence = await presenceOf(editor, set.sessionId);
    const ids = presence.map((m) => m.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("answers 404 for a session the caller cannot read", async () => {
    suite.requireProject();
    const session = await suite.mkSession();

    const res = await send(outsider, "GET", `/sessions/${session.id}/presence`);
    expect(res.status).toBe(404);
  });
});

describe("GET /sessions/:id openOn", () => {
  it("names the owner and machine of a live open session", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    await mkMachine(owner, {
      name: "OpenOn live",
      openSessionId: session.id,
    });

    const res = await send(owner, "GET", `/sessions/${session.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openOn).toMatchObject({
      machine: "OpenOn live",
      owner: { id: owner.userId, name: expect.any(String) },
    });
  });

  it("reports null once the machine is offline", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const machine = await mkMachine(owner, {
      name: "OpenOn stale",
      openSessionId: session.id,
    });
    await goOffline(machine);

    const res = await send(owner, "GET", `/sessions/${session.id}`);
    expect((await res.json()).openOn).toBeNull();
  });

  it("drops the label once the machine's owner has left the session's project", async () => {
    const project = await suite.throwawayProject("Left");
    const session = await suite.mkSession(
      { projectId: project.id },
      project.owner.cookie
    );
    await mkMachine(project.editor, {
      name: "OpenOn left",
      openSessionId: session.id,
    });

    const before = await send(project.owner, "GET", `/sessions/${session.id}`);
    expect(before.status).toBe(200);
    expect((await before.json()).openOn).toMatchObject({
      machine: "OpenOn left",
      owner: { id: project.editor.userId },
    });

    await db
      .delete(members)
      .where(
        and(
          eq(members.projectId, project.id),
          eq(members.userId, project.editor.userId)
        )
      );

    const after = await send(project.owner, "GET", `/sessions/${session.id}`);
    expect(after.status).toBe(200);
    expect((await after.json()).openOn).toBeNull();
  });
});

describe("GET /machines: the set open and the repos pushed", () => {
  const { seedObjects, removeSeeded } = trackSeeds();
  afterAll(removeSeeded);

  const T0 = Date.UTC(2026, 5, 1);

  type Described = {
    id: string;
    openSession: { id: number; name: string; projectId: number } | null;
    pushedRepos: { id: number; name: string; projectId: number }[];
    neverHere: unknown[];
  };

  const describedBy = async (actor: Actor, id: string): Promise<Described> => {
    const res = await send(actor, "GET", "/machines");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.notABounce)).toBe(true);
    return body.machines.find((m: Described) => m.id === id);
  };

  it("names the open session while the machine is online and nothing once it is not", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const id = await mkMachine(owner, {
      name: "Opens a set",
      openSessionId: session.id,
    });

    expect((await describedBy(owner, id)).openSession).toEqual({
      id: session.id,
      name: session.name,
      projectId: suite.projectId,
    });

    await goOffline(id);
    expect((await describedBy(owner, id)).openSession).toBeNull();
  });

  it("lists the repos the machine pushed saves or commits to and no others", async () => {
    suite.requireProject();
    const name = `Pushes ${randomUUID().slice(0, 8)}`;
    const id = await mkMachine(owner, { name });
    const idle = await mkMachine(owner, { name: `Idle ${name}` });
    const bySave = await adoptNewSet(suite, "Pushed by save");
    const byCommit = await adoptNewSet(suite, "Pushed by commit");
    await adoptNewSet(suite, "Never pushed");

    await pushSaves(
      suite,
      bySave,
      "main",
      [savePayload("pm-save", T0, { machineName: name })],
      "owner",
      id
    );
    // Its save names another machine, so only the commit ties it to this one.
    const save = savePayload("pm-commit", T0, { machineName: "Elsewhere" });
    await pushSaves(suite, byCommit, "main", [save], "owner", id);
    await seedObjects(byCommit.repoId, owner.userId, objectsOf(save));
    expect(
      (
        await pushCommits(
          suite,
          byCommit,
          "main",
          [commitPayload("pm-commit", null, [save], { machineName: name })],
          "owner",
          id
        )
      ).status
    ).toBe(201);

    const described = await describedBy(owner, id);
    expect(described.pushedRepos).toEqual([
      {
        id: byCommit.repoId,
        name: "Pushed by commit",
        projectId: suite.projectId,
      },
      { id: bySave.repoId, name: "Pushed by save", projectId: suite.projectId },
    ]);
    expect((await describedBy(owner, idle)).pushedRepos).toEqual([]);
    expect(described.neverHere).toEqual([]);
  });

  it("leaves out a repo of a project the caller has left", async () => {
    const project = await suite.throwawayProject("Pushed then left");
    const repo = await (
      await send(project.owner, "POST", `/projects/${project.id}/repos`, {
        name: "Left repo",
      })
    ).json();
    const adopted = await (
      await send(project.owner, "POST", `/repos/${repo.id}/sets`, {
        ditSetId: "set-left",
        fileName: "left.als",
      })
    ).json();
    const name = `Leaver ${randomUUID().slice(0, 8)}`;
    const id = await mkMachine(project.editor, { name });
    const pushed = await requestAs(project.editor, `/repos/${repo.id}/saves`, {
      method: "POST",
      headers: { "X-Machine-Id": id },
      body: JSON.stringify({
        ditSetId: adopted.ditSetId,
        branch: "main",
        saves: [savePayload("left", T0, { machineName: name })],
      }),
    });
    expect(pushed.status).toBe(200);

    expect((await describedBy(project.editor, id)).pushedRepos).toEqual([
      { id: repo.id, name: "Left repo", projectId: project.id },
    ]);

    await db
      .delete(members)
      .where(
        and(
          eq(members.projectId, project.id),
          eq(members.userId, project.editor.userId)
        )
      );

    expect((await describedBy(project.editor, id)).pushedRepos).toEqual([]);
  });
});

describe("GET /admin/machines", () => {
  const setRole = (actor: Actor, instanceRole: "admin" | "user") =>
    db.update(users).set({ instanceRole }).where(eq(users.id, actor.userId));

  it("lists every account's machines with their owner, and no removed one", async () => {
    suite.requireProject();
    const mine = await mkMachine(owner, { name: "Admin sees mine" });
    const theirs = await mkMachine(editor, { name: "Admin sees theirs" });
    const removed = await mkMachine(editor, { name: "Admin sees removed" });
    await send(editor, "DELETE", `/machines/${removed}`);
    await setRole(owner, "admin");
    try {
      const res = await send(owner, "GET", "/admin/machines?pageSize=200");
      expect(res.status).toBe(200);
      const { items, total } = await res.json();
      expect(total).toBeGreaterThanOrEqual(2);
      const byId = new Map(items.map((m: { id: string }) => [m.id, m]));
      expect(byId.get(mine)).toEqual({
        id: mine,
        name: "Admin sees mine",
        platform: "macOS",
        appVersion: "0.14.0",
        lastSeenAt: expect.any(String),
        owner: { id: owner.userId, name: owner.name },
      });
      expect(byId.get(theirs)).toMatchObject({
        owner: { id: editor.userId, name: editor.name },
      });
      expect(byId.has(removed)).toBe(false);

      const page = await send(
        owner,
        "GET",
        "/admin/machines?page=1&pageSize=1"
      );
      expect((await page.json()).items).toHaveLength(1);
    } finally {
      await setRole(owner, "user");
    }
  });

  it("answers 404 to a non-admin and 401 to nobody", async () => {
    suite.requireProject();
    expect((await send(owner, "GET", "/admin/machines")).status).toBe(404);
    expect((await suite.request("anonymous", "/admin/machines")).status).toBe(
      401
    );
  });
});
