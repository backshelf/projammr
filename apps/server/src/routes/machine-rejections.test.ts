import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { renderRejections } from "../db/schema/machine-rejections.js";
import { setupSuite, signInAgain, type Actor } from "../test/fixtures.js";

const suite = setupSuite("Render rejections");
const { owner, editor, requestAs } = suite;

const send = (actor: Actor, method: string, path: string, body?: unknown) =>
  requestAs(actor, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A machine of the actor's, registered from a sign-in of its own so removing it keeps the actor's. */
async function mkMachine(actor: Actor): Promise<string> {
  const id = randomUUID();
  const res = await send(await signInAgain(actor), "PUT", `/machines/${id}`, {
    name: `Rejecting Mac ${id.slice(0, 8)}`,
    platform: "macOS",
    appVersion: "0.14.0",
    openSessionId: null,
    repoIds: [],
  });
  expect(res.status).toBe(200);
  return id;
}

const fingerprint = () => `4096:${randomUUID().replaceAll("-", "")}`;

type Held = {
  notABounce: {
    id: number;
    fingerprint: string;
    fileName: string | null;
    createdAt: string;
  }[];
  neverHere: { id: number; machineId: string; folder: string }[];
};

const held = async (actor: Actor): Promise<Held> => {
  const res = await send(actor, "GET", "/machines/rejections");
  expect(res.status).toBe(200);
  return res.json();
};

const bounce = (print: string, fileName?: string) => ({
  kind: "not-a-bounce",
  fingerprint: print,
  ...(fileName === undefined ? {} : { fileName }),
});

const never = (machineId: string, folder: string) => ({
  kind: "never-here",
  machineId,
  folder,
});

describe("POST /machines/rejections", () => {
  it("stores the rows, answers them with integer ids and takes a repeat without adding", async () => {
    suite.requireProject();
    const machine = await mkMachine(owner);
    const print = fingerprint();
    const body = {
      items: [
        bounce(print, "demo.wav"),
        never(machine, "/Volumes/Old/Bounces"),
      ],
    };

    const first = await send(owner, "POST", "/machines/rejections", body);
    expect(first.status).toBe(200);
    const { items } = await first.json();
    expect(items).toEqual([
      {
        kind: "not-a-bounce",
        id: expect.any(Number),
        fingerprint: print,
        fileName: "demo.wav",
        createdAt: expect.any(String),
      },
      {
        kind: "never-here",
        id: expect.any(Number),
        machineId: machine,
        folder: "/Volumes/Old/Bounces",
      },
    ]);
    expect(Number.isInteger(items[0].id) && Number.isInteger(items[1].id)).toBe(
      true
    );

    const again = await send(owner, "POST", "/machines/rejections", body);
    expect(again.status).toBe(200);
    expect((await again.json()).items.map((i: { id: number }) => i.id)).toEqual(
      items.map((i: { id: number }) => i.id)
    );

    const listed = await held(owner);
    expect(
      listed.notABounce.filter((r) => r.fingerprint === print)
    ).toHaveLength(1);
    expect(
      listed.neverHere.filter((r) => r.machineId === machine)
    ).toHaveLength(1);
  });

  it("names a file it was first sent without, and keeps the name it has", async () => {
    suite.requireProject();
    const print = fingerprint();
    await send(owner, "POST", "/machines/rejections", {
      items: [bounce(print)],
    });
    expect(
      (await held(owner)).notABounce.find((r) => r.fingerprint === print)
    ).toMatchObject({ fileName: null });

    await send(owner, "POST", "/machines/rejections", {
      items: [bounce(print, "first.wav")],
    });
    await send(owner, "POST", "/machines/rejections", {
      items: [bounce(print, "second.wav")],
    });

    expect(
      (await held(owner)).notABounce.find((r) => r.fingerprint === print)
    ).toMatchObject({ fileName: "first.wav" });
  });

  it("is 403 for a folder of another account's machine and writes none of the write", async () => {
    suite.requireProject();
    const theirs = await mkMachine(editor);
    const print = fingerprint();

    const res = await send(owner, "POST", "/machines/rejections", {
      items: [bounce(print), never(theirs, "/Users/them/Music")],
    });

    expect(res.status).toBe(403);
    expect(
      (await held(owner)).notABounce.some((r) => r.fingerprint === print)
    ).toBe(false);
    expect((await held(editor)).neverHere).toEqual([]);
  });

  it("is 404 for a machine that is unknown or was removed", async () => {
    suite.requireProject();
    const removed = await mkMachine(owner);
    await send(owner, "DELETE", `/machines/${removed}`);

    for (const machine of [randomUUID(), removed]) {
      const res = await send(owner, "POST", "/machines/rejections", {
        items: [never(machine, "/Music")],
      });
      expect(res.status).toBe(404);
    }
  });

  it("refuses more than 1000 items and an empty fingerprint", async () => {
    suite.requireProject();
    const many = Array.from({ length: 1001 }, () => bounce(fingerprint()));
    expect(
      (await send(owner, "POST", "/machines/rejections", { items: many }))
        .status
    ).toBe(400);
    expect(
      (
        await send(owner, "POST", "/machines/rejections", {
          items: [bounce("")],
        })
      ).status
    ).toBe(400);
  });

  it("takes a full write of 1000", async () => {
    suite.requireProject();
    const items = Array.from({ length: 1000 }, () => bounce(fingerprint()));
    const res = await send(owner, "POST", "/machines/rejections", { items });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1000);
  });

  it("is 401 without a sign-in", async () => {
    suite.requireProject();
    const res = await suite.request("anonymous", "/machines/rejections", {
      method: "POST",
      body: JSON.stringify({ items: [] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("whose a rejection is", () => {
  it("keeps a not-a-bounce file to its user, whichever machine told of it", async () => {
    suite.requireProject();
    const print = fingerprint();
    await send(owner, "POST", "/machines/rejections", {
      items: [bounce(print)],
    });

    expect(
      (await held(owner)).notABounce.some((r) => r.fingerprint === print)
    ).toBe(true);
    expect(
      (await held(editor)).notABounce.some((r) => r.fingerprint === print)
    ).toBe(false);

    // The other user can reject the same file on their own.
    const theirs = await send(editor, "POST", "/machines/rejections", {
      items: [bounce(print)],
    });
    expect(theirs.status).toBe(200);
    expect(
      (await held(editor)).notABounce.filter((r) => r.fingerprint === print)
    ).toHaveLength(1);
    expect(
      (await held(owner)).notABounce.filter((r) => r.fingerprint === print)
    ).toHaveLength(1);
  });

  it("keeps a never-here folder to its machine and lists it on that machine's row", async () => {
    suite.requireProject();
    const a = await mkMachine(owner);
    const b = await mkMachine(owner);
    const print = fingerprint();
    await send(owner, "POST", "/machines/rejections", {
      items: [
        never(a, "/Shared/Path"),
        never(b, "/Shared/Path"),
        never(a, "/Only/A"),
        bounce(print),
      ],
    });

    const listed = await held(owner);
    const folders = (id: string) =>
      listed.neverHere.filter((r) => r.machineId === id).map((r) => r.folder);
    expect(folders(a).sort()).toEqual(["/Only/A", "/Shared/Path"]);
    expect(folders(b)).toEqual(["/Shared/Path"]);

    const res = await send(owner, "GET", "/machines");
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = (id: string) =>
      body.machines.find((m: { id: string }) => m.id === id);
    expect(
      row(a)
        .neverHere.map((r: { folder: string }) => r.folder)
        .sort()
    ).toEqual(["/Only/A", "/Shared/Path"]);
    expect(row(b).neverHere.map((r: { folder: string }) => r.folder)).toEqual([
      "/Shared/Path",
    ]);
    // The bounce is the user's: it rides on the list, not on a machine.
    expect(
      body.notABounce.some(
        (r: { fingerprint: string }) => r.fingerprint === print
      )
    ).toBe(true);
  });
});

describe("DELETE /machines/rejections/:id", () => {
  it("deletes one of the caller's rejections", async () => {
    suite.requireProject();
    const machine = await mkMachine(owner);
    const print = fingerprint();
    const { items } = await (
      await send(owner, "POST", "/machines/rejections", {
        items: [bounce(print), never(machine, "/Gone")],
      })
    ).json();

    for (const item of items) {
      expect(
        (await send(owner, "DELETE", `/machines/rejections/${item.id}`)).status
      ).toBe(204);
    }

    const listed = await held(owner);
    expect(listed.notABounce.some((r) => r.fingerprint === print)).toBe(false);
    expect(listed.neverHere.some((r) => r.machineId === machine)).toBe(false);
  });

  it("is 404 for another account's rejection, leaving it in place, and for none", async () => {
    suite.requireProject();
    const print = fingerprint();
    const { items } = await (
      await send(owner, "POST", "/machines/rejections", {
        items: [bounce(print)],
      })
    ).json();

    expect(
      (await send(editor, "DELETE", `/machines/rejections/${items[0].id}`))
        .status
    ).toBe(404);
    expect(
      (await send(owner, "DELETE", "/machines/rejections/2147483000")).status
    ).toBe(404);
    expect(
      (await held(owner)).notABounce.some((r) => r.fingerprint === print)
    ).toBe(true);
  });
});

describe("removing a machine", () => {
  it("deletes its never-here rows and keeps the user's bounces", async () => {
    suite.requireProject();
    const machine = await mkMachine(owner);
    const other = await mkMachine(owner);
    const print = fingerprint();
    await send(owner, "POST", "/machines/rejections", {
      items: [
        never(machine, "/Doomed"),
        never(other, "/Doomed"),
        bounce(print),
      ],
    });

    expect((await send(owner, "DELETE", `/machines/${machine}`)).status).toBe(
      204
    );

    expect(
      await db
        .select()
        .from(renderRejections)
        .where(eq(renderRejections.machineId, machine))
    ).toEqual([]);
    const listed = await held(owner);
    expect(listed.neverHere.map((r) => r.machineId)).toContain(other);
    expect(listed.neverHere.map((r) => r.machineId)).not.toContain(machine);
    expect(listed.notABounce.some((r) => r.fingerprint === print)).toBe(true);
  });
});
