import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { setupSuite } from "../../test/fixtures.js";
import { db } from "../index.js";
import type { SessionSample } from "../schema/samples.js";
import { sessionSamples } from "../schema/session-samples.js";
import { sessions } from "../schema/sessions.js";
import {
  replaceSessionSamples,
  samplesForSessions,
} from "./session-samples.js";

const suite = setupSuite("Session samples");

const kick: SessionSample = {
  path: "Samples/kick.wav",
  kind: "project",
  status: "present",
};
const snare: SessionSample = {
  path: "/Users/x/snare.wav",
  kind: "outside",
  status: "missing",
};
const pad: SessionSample = {
  path: "Library/pad.wav",
  kind: "library",
  status: "unknown",
};

async function replace(
  sessionId: number,
  samples: Parameters<typeof replaceSessionSamples>[3]
) {
  await db.transaction((tx) =>
    replaceSessionSamples(tx, sessionId, suite.projectId, samples)
  );
}

describe("session samples", () => {
  it("reads back what was replaced in the order given", async () => {
    suite.requireProject();
    const { id } = await suite.mkSession();
    await replace(id, [snare, kick, pad]);
    expect((await samplesForSessions([id])).get(id)).toEqual([
      snare,
      kick,
      pad,
    ]);
  });

  it("removes the rows a shorter replacement leaves out", async () => {
    suite.requireProject();
    const { id } = await suite.mkSession();
    await replace(id, [kick, snare, pad]);
    await replace(id, [pad]);
    expect((await samplesForSessions([id])).get(id)).toEqual([pad]);
  });

  it("deletes every row when the replacement is empty", async () => {
    suite.requireProject();
    const { id } = await suite.mkSession();
    await replace(id, [kick]);
    await replace(id, []);
    expect((await samplesForSessions([id])).has(id)).toBe(false);
  });

  it("collapses a repeated path to the last entry", async () => {
    suite.requireProject();
    const { id } = await suite.mkSession();
    await replace(id, [
      kick,
      snare,
      { ...kick, kind: "library", status: "missing" },
    ]);
    expect((await samplesForSessions([id])).get(id)).toEqual([
      snare,
      { ...kick, kind: "library", status: "missing" },
    ]);
  });

  it("keeps sessions apart and answers an empty id list with an empty map", async () => {
    suite.requireProject();
    const a = await suite.mkSession();
    const b = await suite.mkSession();
    await replace(a.id, [kick]);
    await replace(b.id, [snare]);
    const map = await samplesForSessions([a.id, b.id]);
    expect(map.get(a.id)).toEqual([kick]);
    expect(map.get(b.id)).toEqual([snare]);
    expect((await samplesForSessions([])).size).toBe(0);
  });

  it("removes a session's samples when the session is deleted", async () => {
    suite.requireProject();
    const { id } = await suite.mkSession();
    await replace(id, [kick, snare]);
    await db.delete(sessions).where(eq(sessions.id, id));
    expect((await samplesForSessions([id])).has(id)).toBe(false);
    const rows = await db
      .select()
      .from(sessionSamples)
      .where(eq(sessionSamples.sessionId, id));
    expect(rows).toEqual([]);
  });
});
