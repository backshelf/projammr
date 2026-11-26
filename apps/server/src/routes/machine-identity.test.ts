import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { machines } from "../db/schema/machines.js";
import { commits, repos, timeSegments } from "../db/schema/repos.js";
import { saves } from "../db/schema/saves.js";
import { getSessionHistory } from "../db/queries/commits.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  pushSegments,
  registerMachine,
  savePayload,
  trackSeeds,
  type SegmentPayload,
} from "../test/dit-history.js";
import { setupSuite, signInAgain } from "../test/fixtures.js";

const suite = setupSuite("Machine identity");
const { owner, requireProject, request } = suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);

const T0 = Date.UTC(2026, 5, 1);
const MINUTE = 60_000;

const span = (
  machineName: string,
  startedAt: number,
  endedAt: number
): SegmentPayload => ({
  branch: "main",
  machineName,
  startedAt,
  endedAt,
  source: "script",
});

/** A machine name no other test of the owner holds. */
const nameOf = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

/**
 * A machine of the owner's registered from a sign-in of its own, as the app's
 * is, so removing it ends that sign-in and not the suite's.
 */
async function registerSeparately(name: string): Promise<string> {
  const id = randomUUID();
  const res = await suite.requestAs(
    await signInAgain(owner),
    `/machines/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name,
        platform: "macOS",
        appVersion: "0.14.0",
        openSessionId: null,
        repoIds: [],
      }),
    }
  );
  expect(res.status).toBe(200);
  return id;
}

const saveRows = (sessionId: number) =>
  db
    .select()
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(asc(saves.fileUpdatedAt));

const commitRows = (repoId: number) =>
  db
    .select()
    .from(commits)
    .where(eq(commits.repoId, repoId))
    .orderBy(asc(commits.committedAt));

const segmentRows = (sessionId: number) =>
  db
    .select()
    .from(timeSegments)
    .where(eq(timeSegments.sessionId, sessionId))
    .orderBy(asc(timeSegments.startedAt));

const lastPushMachineOf = async (repoId: number) =>
  (await db.select().from(repos).where(eq(repos.id, repoId)))[0]!
    .lastPushMachineId;

const savesOf = async (sessionId: number) => {
  const res = await request("owner", `/sessions/${sessionId}/saves`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    fileUpdatedAt: string;
    machineName: string | null;
    machineId: string | null;
  }[];
};

describe("pushes attribute their rows to the pushing machine", () => {
  it("takes the rows that name the machine and nulls the ones that name another", async () => {
    requireProject();
    const name = nameOf("Studio");
    const other = "Somebody else's Mac";
    const machine = await registerMachine(suite, "owner", name);
    const set = await adoptNewSet(suite, "Attribution");
    const mine = savePayload("id-mine", T0, { machineName: name });
    const theirs = savePayload("id-theirs", T0 + MINUTE, {
      machineName: other,
    });

    expect(
      (await pushSaves(suite, set, "main", [mine], "owner", machine)).status
    ).toBe(200);
    expect(await lastPushMachineOf(set.repoId)).toBe(machine);

    expect(
      (await pushSaves(suite, set, "main", [theirs], "owner", machine)).status
    ).toBe(200);
    // The repo's last push is attributed by the last row it pushed.
    expect(await lastPushMachineOf(set.repoId)).toBeNull();

    expect(
      (await saveRows(set.sessionId)).map((row) => [
        row.machineName,
        row.machineId,
      ])
    ).toEqual([
      [name, machine],
      [other, null],
    ]);

    await seedObjects(
      set.repoId,
      owner.userId,
      [mine, theirs].flatMap(objectsOf)
    );
    const first = commitPayload("id-c1", null, [mine], { machineName: name });
    const second = commitPayload("id-c2", first.hash, [theirs], {
      machineName: other,
    });
    expect(
      (await pushCommits(suite, set, "main", [first, second], "owner", machine))
        .status
    ).toBe(201);
    expect(
      (await commitRows(set.repoId)).map((row) => [
        row.machineName,
        row.machineId,
      ])
    ).toEqual([
      [name, machine],
      [other, null],
    ]);

    expect(
      (
        await pushSegments(
          suite,
          set,
          [
            span(name, T0, T0 + MINUTE),
            span(other, T0 + 2 * MINUTE, T0 + 3 * MINUTE),
          ],
          "owner",
          machine
        )
      ).status
    ).toBe(200);
    expect(
      (await segmentRows(set.sessionId)).map((row) => [
        row.machineName,
        row.machineId,
      ])
    ).toEqual([
      [name, machine],
      [other, null],
    ]);
  });

  it("answers the machine's current name for its rows once it is renamed, and leaves a foreign name alone", async () => {
    requireProject();
    const before = nameOf("Before");
    const after = nameOf("After");
    const other = "Somebody else's Mac";
    const machine = await registerMachine(suite, "owner", before);
    const set = await adoptNewSet(suite, "Renamed history");
    await pushSaves(
      suite,
      set,
      "main",
      [
        savePayload("rn-a", T0, { machineName: before }),
        savePayload("rn-b", T0 + MINUTE, { machineName: other }),
      ],
      "owner",
      machine
    );

    const rename = await request("owner", `/machines/${machine}`, {
      method: "PUT",
      body: JSON.stringify({
        name: after,
        platform: "macOS",
        appVersion: "0.14.0",
        openSessionId: null,
        repoIds: [],
      }),
    });
    expect(rename.status).toBe(200);

    expect(
      (await savesOf(set.sessionId))
        .map((row) => [row.machineName, row.machineId])
        .reverse()
    ).toEqual([
      [after, machine],
      [other, null],
    ]);
    // The row itself keeps the name it was saved under.
    expect((await saveRows(set.sessionId))[0]?.machineName).toBe(before);
  });
});

describe("a pushed machine name", () => {
  it("attributes to the machine when it carries the padding the hub cuts from the beat's name", async () => {
    requireProject();
    const name = nameOf("Padded");
    const machine = await registerMachine(suite, "owner", name);
    const set = await adoptNewSet(suite, "Padded name");
    const save = savePayload("pad-a", T0, { machineName: `  ${name}  ` });

    expect(
      (await pushSaves(suite, set, "main", [save], "owner", machine)).status
    ).toBe(200);

    expect(
      (await saveRows(set.sessionId)).map((row) => [
        row.machineName,
        row.machineId,
      ])
    ).toEqual([[name, machine]]);
  });
});

describe("a session's history", () => {
  it("counts one machine once when some of its saves carry its id and some do not", async () => {
    requireProject();
    const name = nameOf("Counted");
    const machine = await registerMachine(suite, "owner", name);
    const set = await adoptNewSet(suite, "Machine count");
    await pushSaves(
      suite,
      set,
      "main",
      [
        savePayload("mc-a", T0, { machineName: name }),
        savePayload("mc-b", T0 + MINUTE, { machineName: name }),
      ],
      "owner",
      machine
    );
    const [first] = await saveRows(set.sessionId);
    await db
      .update(saves)
      .set({ machineId: null })
      .where(eq(saves.id, first!.id));

    expect((await getSessionHistory(set.sessionId)).machines).toBe(1);
  });
});

describe("a repo's last push machine", () => {
  it("is marked removed once its machine is", async () => {
    requireProject();
    const name = nameOf("Gone");
    const machine = await registerSeparately(name);
    const set = await adoptNewSet(suite, "Gone machine");
    await pushSaves(
      suite,
      set,
      "main",
      [savePayload("gone-a", T0, { machineName: name })],
      "owner",
      machine
    );
    const lastPush = async () =>
      (
        (await (await request("owner", `/repos/${set.repoId}`)).json()) as {
          lastPushMachine: { id: string; removed: boolean } | null;
        }
      ).lastPushMachine;

    expect(await lastPush()).toMatchObject({ id: machine, removed: false });
    await request("owner", `/machines/${machine}`, { method: "DELETE" });
    expect(await lastPush()).toMatchObject({ id: machine, removed: true });
  });
});

describe("/me/projects", () => {
  it("names the caller's own role in each project", async () => {
    requireProject();
    const roleOf = async (caller: "viewer" | "editor" | "owner") => {
      const res = await request(caller, "/me/projects");
      expect(res.status).toBe(200);
      return ((await res.json()) as { id: number; role: string }[]).find(
        (project) => project.id === suite.projectId
      )?.role;
    };

    expect(await roleOf("viewer")).toBe("viewer");
    expect(await roleOf("editor")).toBe("editor");
    expect(await roleOf("owner")).toBe("owner");
  });
});

describe("a push names its machine", () => {
  it("answers 409 machine_not_registered for an id no machine holds and for no id", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Unregistered");
    const save = savePayload("un-a", T0);

    for (const machine of [randomUUID(), null]) {
      const res = await pushSaves(suite, set, "main", [save], "owner", machine);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("machine_not_registered");
    }
    expect(await saveRows(set.sessionId)).toEqual([]);
  });

  it("refuses another account's machine with 403", async () => {
    requireProject();
    const set = await adoptNewSet(suite, "Foreign machine");
    const theirs = await registerMachine(suite, "editor", nameOf("Editor Mac"));

    const res = await pushSaves(
      suite,
      set,
      "main",
      [savePayload("fm-a", T0)],
      "owner",
      theirs
    );
    expect(res.status).toBe(403);
    expect(await saveRows(set.sessionId)).toEqual([]);
  });
});

describe("removing a machine", () => {
  it("answers a push from its id with 401, keeps its rows under its last name and frees the name", async () => {
    requireProject();
    const name = nameOf("Doomed");
    const machine = await registerSeparately(name);
    const set = await adoptNewSet(suite, "Removed machine");
    const save = savePayload("rm-a", T0, { machineName: name });
    await pushSaves(suite, set, "main", [save], "owner", machine);
    await seedObjects(set.repoId, owner.userId, objectsOf(save));
    const commit = commitPayload("rm-c", null, [save], { machineName: name });
    await pushCommits(suite, set, "main", [commit], "owner", machine);
    await pushSegments(
      suite,
      set,
      [span(name, T0, T0 + MINUTE)],
      "owner",
      machine
    );

    expect(
      (await request("owner", `/machines/${machine}`, { method: "DELETE" }))
        .status
    ).toBe(204);

    for (const res of [
      await pushSaves(suite, set, "main", [save], "owner", machine),
      await pushCommits(suite, set, "main", [commit], "owner", machine),
      await pushSegments(
        suite,
        set,
        [span(name, T0, T0 + MINUTE)],
        "owner",
        machine
      ),
    ]) {
      expect(res.status).toBe(401);
    }

    // Every row still points at the machine, whose row is kept, marked removed.
    expect((await saveRows(set.sessionId)).map((row) => row.machineId)).toEqual(
      [machine]
    );
    expect((await commitRows(set.repoId)).map((row) => row.machineId)).toEqual([
      machine,
    ]);
    expect(
      (await segmentRows(set.sessionId)).map((row) => row.machineId)
    ).toEqual([machine]);
    expect(await lastPushMachineOf(set.repoId)).toBe(machine);
    const [kept] = await db
      .select()
      .from(machines)
      .where(eq(machines.id, machine));
    expect(kept?.removedAt).not.toBeNull();
    expect(
      (await savesOf(set.sessionId)).map((row) => [
        row.machineName,
        row.machineId,
      ])
    ).toEqual([[name, machine]]);

    // The name is free: a new registration takes it, and the history stays
    // with the removed machine.
    const reused = await registerSeparately(name);
    expect(reused).not.toBe(machine);
    expect((await saveRows(set.sessionId)).map((row) => row.machineId)).toEqual(
      [machine]
    );
  });
});
