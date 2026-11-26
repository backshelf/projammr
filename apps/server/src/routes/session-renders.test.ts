import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { saves } from "../db/schema/saves.js";
import { sessions } from "../db/schema/sessions.js";
import { trackAudios } from "../db/schema/tracks.js";
import { setupSuite } from "../test/fixtures.js";
import { withProjectPolicyForTest } from "../db/queries/project-policy.js";
import {
  adoptNewSet,
  commitPayload,
  objectsOf,
  pushCommits,
  pushSaves,
  type SavePayload,
  savePayload,
  trackSeeds,
} from "../test/dit-history.js";

const suite = setupSuite("Session renders");
const { owner, requireProject, request, expectAccess, mkTrack, uploadAsset } =
  suite;
const { seedObjects, removeSeeded } = trackSeeds();

afterAll(removeSeeded);

const T0 = Date.UTC(2026, 5, 1);

/** A session of its own on a track, with one save pushed to it. */
async function sessionWithSave(label: string, trackId: number | null) {
  const set = await adoptNewSet(suite, label);
  const save = savePayload(label, T0);
  await seedObjects(set.repoId, owner.userId, objectsOf(save));
  await pushSaves(suite, set, "main", [save]);
  const [row] = await db
    .select({ id: saves.id })
    .from(saves)
    .where(eq(saves.hash, save.hash));
  await db
    .update(sessions)
    .set({ trackId })
    .where(eq(sessions.id, set.sessionId));
  return { sessionId: set.sessionId, saveId: row!.id };
}

function accept(
  sessionId: number,
  body: { assetId: number; bouncedFromSaveId: number | null },
  caller: "owner" | "viewer" | "outsider" = "owner"
) {
  return request(caller, `/sessions/${sessionId}/renders`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("session renders", () => {
  it("accepts a render: attaches it, links it as a version, records the bounce", async () => {
    requireProject();
    const trackId = await mkTrack("Render Track");
    const { sessionId, saveId } = await sessionWithSave("Accept", trackId);
    const asset = await uploadAsset("accept-render.wav");

    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: saveId,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.trackId).toBe(trackId);
    expect(body.attached).toBe(true);
    expect(body.audios).toHaveLength(1);
    expect(body.audios[0].assetId).toBe(asset.id);
    expect(body.audios[0].isPrimary).toBe(true);
    expect(body.audios[0].primaryPinned).toBe(false);
    expect(body.audios[0].bouncedFrom).not.toBeNull();
    expect(body.audios[0].bouncedFrom.saveId).toBe(saveId);
    expect(body.audios[0].bouncedFrom.sessionId).toBe(sessionId);

    const [row] = await db
      .select({ bouncedFromSaveId: trackAudios.bouncedFromSaveId })
      .from(trackAudios)
      .where(eq(trackAudios.assetId, asset.id));
    expect(row!.bouncedFromSaveId).toBe(saveId);
  });

  it("replaying the same accept converges on one version", async () => {
    requireProject();
    const trackId = await mkTrack("Replay Track");
    const { sessionId, saveId } = await sessionWithSave("Replay", trackId);
    const asset = await uploadAsset("replay-render.wav");
    const body = { assetId: asset.id, bouncedFromSaveId: saveId };

    expect((await accept(sessionId, body)).status).toBe(201);
    const again = await accept(sessionId, body);
    expect(again.status).toBe(201);
    expect((await again.json()).audios).toHaveLength(1);
  });

  it("refuses a session with no track (409)", async () => {
    requireProject();
    const { sessionId } = await sessionWithSave("No Track", null);
    const asset = await uploadAsset("no-track-render.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: null,
    });
    expect(res.status).toBe(409);
  });

  it("refuses a bounced save that belongs to another session (400)", async () => {
    requireProject();
    const trackId = await mkTrack("Foreign Save Track");
    const { sessionId } = await sessionWithSave("Foreign A", trackId);
    const other = await sessionWithSave("Foreign B", trackId);
    const asset = await uploadAsset("foreign-render.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: other.saveId,
    });
    expect(res.status).toBe(400);
  });

  it("requires the editor role: viewers get 403, outsiders 404", async () => {
    requireProject();
    const trackId = await mkTrack("Role Track");
    const { sessionId } = await sessionWithSave("Role", trackId);
    const asset = await uploadAsset("role-render.wav");
    const body = { assetId: asset.id, bouncedFromSaveId: null };
    expect((await accept(sessionId, body, "viewer")).status).toBe(403);
    expect((await accept(sessionId, body, "outsider")).status).toBe(404);
  });

  it("is covered by the access matrix", async () => {
    requireProject();
    const trackId = await mkTrack("Matrix Track");
    const { sessionId } = await sessionWithSave("Matrix", trackId);
    const asset = await uploadAsset("matrix-render.wav");
    await expectAccess(
      "POST",
      `/sessions/${sessionId}/renders`,
      { owner: 201, outsider: 404 },
      { assetId: asset.id, bouncedFromSaveId: null }
    );
  });

  it("promotes the newest accepted render unless the primary is pinned", async () => {
    requireProject();
    const trackId = await mkTrack("Pin Track");
    const { sessionId } = await sessionWithSave("Pin", trackId);
    const first = await uploadAsset("pin-first.wav");
    const second = await uploadAsset("pin-second.wav");
    const third = await uploadAsset("pin-third.wav");

    const a = await accept(sessionId, {
      assetId: first.id,
      bouncedFromSaveId: null,
    });
    expect(a.status).toBe(201);
    const b = await accept(sessionId, {
      assetId: second.id,
      bouncedFromSaveId: null,
    });
    const bodyB = await b.json();
    expect(
      bodyB.audios.find((r: { assetId: number }) => r.assetId === second.id)
        .isPrimary
    ).toBe(true);

    // Pinning the first render keeps it primary when a newer one is accepted.
    const firstRow = (
      await (await request("owner", `/tracks/${trackId}`)).json()
    ).audios.find((r: { assetId: number }) => r.assetId === first.id);
    const pin = await request("owner", `/track-audios/${firstRow.id}/primary`, {
      method: "PATCH",
    });
    expect(pin.status).toBe(200);

    const c = await accept(sessionId, {
      assetId: third.id,
      bouncedFromSaveId: null,
    });
    const bodyC = await c.json();
    expect(
      bodyC.audios.find((r: { assetId: number }) => r.assetId === first.id)
        .isPrimary
    ).toBe(true);
    expect(
      bodyC.audios.find((r: { assetId: number }) => r.assetId === third.id)
        .isPrimary
    ).toBe(false);
  });
});

describe("render bounce, analysis and pin", () => {
  /** A session on a track holding the given saves, with a commit on the last one when asked. */
  async function sessionWithHistory(
    label: string,
    trackId: number,
    pushed: SavePayload[],
    commit: boolean
  ) {
    const set = await adoptNewSet(suite, label);
    await seedObjects(set.repoId, owner.userId, pushed.flatMap(objectsOf));
    await pushSaves(suite, set, "main", pushed);
    if (commit) {
      await pushCommits(suite, set, "main", [
        commitPayload(label, null, pushed),
      ]);
    }
    await db
      .update(sessions)
      .set({ trackId })
      .where(eq(sessions.id, set.sessionId));
    const rows = await db
      .select({ id: saves.id, hash: saves.hash })
      .from(saves)
      .where(eq(saves.sessionId, set.sessionId));
    const saveIdOf = (save: SavePayload) =>
      rows.find((row) => row.hash === save.hash)!.id;
    return { sessionId: set.sessionId, saveIdOf };
  }

  it("names the commit made on exactly the bounced save", async () => {
    requireProject();
    const trackId = await mkTrack("Exact Bounce");
    const save = savePayload("Exact Bounce", T0);
    const { sessionId, saveIdOf } = await sessionWithHistory(
      "Exact Bounce",
      trackId,
      [save],
      true
    );
    const asset = await uploadAsset("exact-bounce.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: saveIdOf(save),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const bounced = body.audios.find(
      (r: { assetId: number }) => r.assetId === asset.id
    );
    expect(bounced.bouncedFrom.saveId).toBe(saveIdOf(save));
    expect(bounced.bouncedFrom.commit.message).toBe("Exact Bounce");
  });

  it("names the first later commit that covers a save with none of its own", async () => {
    requireProject();
    const trackId = await mkTrack("Covering Bounce");
    const early = savePayload("Covering Early", T0);
    const late = savePayload("Covering Late", T0 + 1000);
    const { sessionId, saveIdOf } = await sessionWithHistory(
      "Covering",
      trackId,
      [early, late],
      true
    );
    const asset = await uploadAsset("covering-bounce.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: saveIdOf(early),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const bounced = body.audios.find(
      (r: { assetId: number }) => r.assetId === asset.id
    );
    expect(bounced.bouncedFrom.saveId).toBe(saveIdOf(early));
    expect(bounced.bouncedFrom.commit.message).toBe("Covering");
  });

  it("keeps the bounce with no commit when nothing covers the save", async () => {
    requireProject();
    const trackId = await mkTrack("Uncovered Bounce");
    const save = savePayload("Uncovered Bounce", T0 + 5000);
    const { sessionId, saveIdOf } = await sessionWithHistory(
      "Uncovered Bounce",
      trackId,
      [save],
      false
    );
    const asset = await uploadAsset("uncovered-bounce.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: saveIdOf(save),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const bounced = body.audios.find(
      (r: { assetId: number }) => r.assetId === asset.id
    );
    expect(bounced.bouncedFrom.saveId).toBe(saveIdOf(save));
    expect(bounced.bouncedFrom.commit).toBeNull();
  });

  it("records no bounce when the render names no save", async () => {
    requireProject();
    const trackId = await mkTrack("No Bounce");
    const { sessionId } = await sessionWithSave("No Bounce", trackId);
    const asset = await uploadAsset("no-bounce.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: null,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const rendered = body.audios.find(
      (r: { assetId: number }) => r.assetId === asset.id
    );
    expect(rendered.bouncedFrom).toBeNull();
  });

  it("queues an analysis on accept where the project analyses on link", async () => {
    requireProject();
    const trackId = await mkTrack("Analysed Accept");
    const { sessionId } = await sessionWithSave("Analysed Accept", trackId);
    const asset = await uploadAsset("analysed-accept.wav");
    const res = await accept(sessionId, {
      assetId: asset.id,
      bouncedFromSaveId: null,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.analysisJobIds).toHaveLength(1);
  });

  it("queues no analysis on accept where the project does not analyse on link", async () => {
    requireProject();
    const trackId = await mkTrack("Unanalysed Accept");
    const { sessionId } = await sessionWithSave("Unanalysed Accept", trackId);
    const asset = await uploadAsset("unanalysed-accept.wav");
    const res = await withProjectPolicyForTest(
      suite.projectId,
      { audio: { autoAnalyse: false } },
      () => accept(sessionId, { assetId: asset.id, bouncedFromSaveId: null })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.analysisJobIds).toEqual([]);
  });

  it("pins a primary the link names explicitly, so a later link keeps it", async () => {
    requireProject();
    const trackId = await mkTrack("Explicit Pin");
    const first = await uploadAsset("explicit-pin-a.wav");
    const second = await uploadAsset("explicit-pin-b.wav");
    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({
        assetIds: [first.id],
        primaryAssetId: first.id,
      }),
    });
    expect(linked.status).toBe(201);
    const later = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [second.id] }),
    });
    expect(later.status).toBe(201);
    const body = await later.json();
    const kept = body.audios.find(
      (a: { assetId: number }) => a.assetId === first.id
    );
    expect(kept.isPrimary).toBe(true);
    expect(kept.primaryPinned).toBe(true);
  });
});
