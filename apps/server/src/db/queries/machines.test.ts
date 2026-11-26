import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { setupSuite } from "../../test/fixtures.js";
import { db } from "../index.js";
import { authSessions } from "../schema/auth.js";
import { machines } from "../schema/machines.js";
import { listMachines, openOnFor, recordMachineBeat } from "./machines.js";

const suite = setupSuite("Machine queries");
const { owner } = suite;

const beat = (name: string, openSessionId: number | null = null) => ({
  name,
  platform: "macOS",
  appVersion: "0.14.0",
  openSessionId,
  repoIds: [],
});

/** The id of the sign-in the owner holds, which a beat notes. */
async function ownerSession(): Promise<string> {
  const [row] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.token, owner.token));
  return row!.id;
}

/** Sets a machine's last beat to `ageMs` before now. */
async function ageBeat(id: string, ageMs: number) {
  await db
    .update(machines)
    .set({ lastSeenAt: new Date(Date.now() - ageMs) })
    .where(eq(machines.id, id));
}

describe("machine queries", () => {
  it("counts a machine online up to 90 s after its last beat and no longer", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const id = randomUUID();
    await recordMachineBeat(
      id,
      owner.userId,
      beat("Window edge", session.id),
      await ownerSession()
    );

    await ageBeat(id, 89_000);
    const within = (await listMachines(owner.userId)).find((m) => m.id === id);
    expect(within?.online).toBe(true);
    expect((await openOnFor(session.id))?.machine).toBe("Window edge");

    await ageBeat(id, 91_000);
    const past = (await listMachines(owner.userId)).find((m) => m.id === id);
    expect(past?.online).toBe(false);
    expect(await openOnFor(session.id)).toBeNull();
  });

  it("lists machines most recently seen first", async () => {
    suite.requireProject();
    const older = randomUUID();
    const middle = randomUUID();
    const newest = randomUUID();
    const signIn = await ownerSession();
    await recordMachineBeat(
      older,
      owner.userId,
      beat(`Order ${older}`),
      signIn
    );
    await recordMachineBeat(
      middle,
      owner.userId,
      beat(`Order ${middle}`),
      signIn
    );
    await recordMachineBeat(
      newest,
      owner.userId,
      beat(`Order ${newest}`),
      signIn
    );
    await ageBeat(older, 50_000);
    await ageBeat(middle, 30_000);
    await ageBeat(newest, 10_000);

    const ours = new Set<string>([older, middle, newest]);
    const ids = (await listMachines(owner.userId))
      .map((m) => m.id)
      .filter((id) => ours.has(id));
    expect(ids).toEqual([newest, middle, older]);
  });
});
