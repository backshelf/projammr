import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { jobs } from "../../db/schema/jobs.js";
import {
  trackAudioDiffs,
  trackAudioFeatures,
} from "../../db/schema/track-audio-analysis.js";
import { trackAudios } from "../../db/schema/tracks.js";
import { servedAt, setParentImage, setupSuite } from "../../test/fixtures.js";
import {
  makeAudible,
  settleJobs,
  settleSubjectJobs,
} from "../../test/media.js";

const suite = setupSuite("Track Audio");
const {
  owner,
  outsider,
  requireProject,
  request,
  expectAccess,
  mkTrack,
  mkCollection,
  mkSession,
  uploadAsset,
  uploadImage,
} = suite;

/** Unwraps a link response's `audios`, the versions the POST actually linked. */
async function linkedAudios<T>(
  res: Response | Promise<Response>
): Promise<T[]> {
  return ((await (await res).json()) as { audios: T[] }).audios;
}

describe("track audios", () => {
  it("links audios, sets a primary, and unlinks with dense versions", async () => {
    requireProject();
    const trackId = await mkTrack("Primary Track");
    const asset1 = await uploadAsset("primary-1.wav");
    const asset2 = await uploadAsset("primary-2.wav");

    const link1 = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset1.id] }),
    });
    expect(link1.status).toBe(201);
    const rows1 = await linkedAudios<{
      id: number;
      assetId: number;
      version: number;
      isPrimary: boolean;
    }>(link1);
    // The first linked audio becomes primary by default.
    expect(rows1).toHaveLength(1);
    expect(rows1[0]!.isPrimary).toBe(true);
    expect(rows1[0]!.version).toBe(1);

    // Linking a second asset is idempotent for the first and resequences.
    const link2 = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset1.id, asset2.id] }),
    });
    expect(link2.status).toBe(201);
    const rows2 = await linkedAudios<(typeof rows1)[number]>(link2);
    expect(rows2.map((r) => r.version)).toEqual([1, 2]);
    expect(rows2.filter((r) => r.isPrimary)).toHaveLength(1);

    const audio2 = rows2.find((r) => r.assetId === asset2.id)!;
    const setPrimary = await request(
      "owner",
      `/track-audios/${audio2.id}/primary`,
      { method: "PATCH" }
    );
    expect(setPrimary.status).toBe(200);

    const track = await (await request("owner", `/tracks/${trackId}`)).json();
    expect(track.primaryAudio.assetId).toBe(asset2.id);
    expect(
      track.audios.filter((a: { isPrimary: boolean }) => a.isPrimary)
    ).toHaveLength(1);

    // Unlinking the primary resequences and leaves the other as the sole row.
    const unlink = await request("owner", `/track-audios/${audio2.id}`, {
      method: "DELETE",
    });
    expect(unlink.status).toBe(204);
    const remaining = (await (
      await request("owner", `/tracks/${trackId}/audios`)
    ).json()) as { assetId: number; version: number }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.assetId).toBe(asset1.id);
    expect(remaining[0]!.version).toBe(1);
  });

  it("versions are dense, 1-based, in localFileCreatedAt order", async () => {
    requireProject();
    const trackId = await mkTrack("Ordered Track");

    const t = Date.parse("2026-03-01T00:00:00.000Z");
    const day = 86_400_000;
    // Upload out of chronological order; version must follow the file dates.
    const mid = await uploadAsset("mid.mp3", {
      localFileCreatedAt: String(t + day),
    });
    const oldest = await uploadAsset("oldest.mp3", {
      localFileCreatedAt: String(t),
    });
    const newest = await uploadAsset("newest.mp3", {
      localFileCreatedAt: String(t + 2 * day),
    });

    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [mid.id, oldest.id, newest.id] }),
    });
    expect(res.status).toBe(201);
    const rows = await linkedAudios<{ assetId: number; version: number }>(res);
    const byAsset = Object.fromEntries(rows.map((r) => [r.assetId, r.version]));
    expect(byAsset[oldest.id]).toBe(1);
    expect(byAsset[mid.id]).toBe(2);
    expect(byAsset[newest.id]).toBe(3);
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2, 3]);
  });

  it("linking an older-dated asset renumbers around it", async () => {
    requireProject();
    const trackId = await mkTrack("Renumber Track");

    const t = Date.parse("2026-04-01T00:00:00.000Z");
    const day = 86_400_000;
    const first = await uploadAsset("first.wav", {
      localFileCreatedAt: String(t + day),
    });
    const second = await uploadAsset("second.wav", {
      localFileCreatedAt: String(t + 2 * day),
    });

    await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [first.id, second.id] }),
    });

    // Predates both existing versions, so it takes version 1 and shifts the
    // rest up — the case resequenceVersions' negate-then-set exists for.
    const older = await uploadAsset("older.wav", {
      localFileCreatedAt: String(t),
    });
    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [older.id] }),
    });
    expect(res.status).toBe(201);
    const rows = await linkedAudios<{ assetId: number; version: number }>(res);
    const byAsset = Object.fromEntries(rows.map((r) => [r.assetId, r.version]));
    expect(byAsset[older.id]).toBe(1);
    expect(byAsset[first.id]).toBe(2);
    expect(byAsset[second.id]).toBe(3);
  });

  it("deleting a middle version keeps the rest dense", async () => {
    requireProject();
    const trackId = await mkTrack("Delete Middle Track");

    const t = Date.parse("2026-05-01T00:00:00.000Z");
    const day = 86_400_000;
    const v1 = await uploadAsset("v1.flac", { localFileCreatedAt: String(t) });
    const v2 = await uploadAsset("v2.flac", {
      localFileCreatedAt: String(t + day),
    });
    const v3 = await uploadAsset("v3.flac", {
      localFileCreatedAt: String(t + 2 * day),
    });

    const linked = await linkedAudios<{
      id: number;
      assetId: number;
      version: number;
    }>(
      await request("owner", `/tracks/${trackId}/audios`, {
        method: "POST",
        body: JSON.stringify({ assetIds: [v1.id, v2.id, v3.id] }),
      })
    );
    const middle = linked.find((r) => r.assetId === v2.id)!;

    const del = await request("owner", `/track-audios/${middle.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    const rows = (await (
      await request("owner", `/tracks/${trackId}/audios`)
    ).json()) as { assetId: number; version: number }[];
    expect(rows.map((r) => r.assetId)).toEqual([v1.id, v3.id]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it("links only the audio assets in a mixed batch", async () => {
    requireProject();
    const trackId = await mkTrack("Mixed Batch Track");
    const audio = await uploadAsset("mixed.mp3");
    const cover = await uploadAsset("mixed-cover.png");

    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [cover.id, audio.id] }),
    });
    expect(res.status).toBe(201);
    const rows = await linkedAudios<{ assetId: number; version: number }>(res);
    expect(rows.map((r) => r.assetId)).toEqual([audio.id]);
    expect(rows[0]!.version).toBe(1);

    // A batch with nothing audio in it links nothing at all.
    const onlyImages = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [cover.id] }),
    });
    expect(onlyImages.status).toBe(201);
    expect(await linkedAudios(onlyImages)).toHaveLength(1);
  });

  it("rejects a primaryAssetId that is not in assetIds", async () => {
    requireProject();
    const trackId = await mkTrack("Primary Mismatch Track");
    const a1 = await uploadAsset("mismatch-1.mp3");
    const a2 = await uploadAsset("mismatch-2.mp3");

    const res = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [a1.id], primaryAssetId: a2.id }),
    });
    expect(res.status).toBe(400);
    expect(
      (await (
        await request("owner", `/tracks/${trackId}/audios`)
      ).json()) as unknown[]
    ).toHaveLength(0);
  });

  it("re-POSTing the same ids is idempotent, with no version drift", async () => {
    requireProject();
    const trackId = await mkTrack("Idempotent Track");
    const a1 = await uploadAsset("i1.mp3");
    const a2 = await uploadAsset("i2.mp3");

    const link = () =>
      linkedAudios<{ id: number; assetId: number; version: number }>(
        request("owner", `/tracks/${trackId}/audios`, {
          method: "POST",
          body: JSON.stringify({ assetIds: [a1.id, a2.id] }),
        })
      );

    const first = await link();
    const second = await link();

    expect(second).toHaveLength(2);
    // Same rows, same versions — no duplicate inserts, no resequence drift.
    expect(second.map((r) => r.id).sort()).toEqual(
      first.map((r) => r.id).sort()
    );
    expect(
      Object.fromEntries(second.map((r) => [r.assetId, r.version]))
    ).toEqual(Object.fromEntries(first.map((r) => [r.assetId, r.version])));
  });

  /*
   * The player builds its card straight from the audio response: the track's
   * title and artists, the release it sits on, and the accent the page tint
   * comes from. Without them, queueing N tracks cost a detail fetch and an
   * image-list fetch each.
   */
  it("carries the owning track's player metadata on each audio", async () => {
    requireProject();
    const trackId = await mkTrack("Owner Meta Track");
    const collectionId = await mkCollection("Owner Meta Collection");
    const linked = await request(
      "owner",
      `/collections/${collectionId}/tracks`,
      { method: "POST", body: JSON.stringify({ trackId }) }
    );
    expect(linked.status).toBe(200);

    const image = await uploadImage("owner-meta-cover.jpeg");
    const cover = await setParentImage(
      (path, init) => request("owner", path, init),
      {
        imageId: image.id,
        kind: "track",
        parentId: trackId,
        projectId: suite.projectId,
      }
    );
    expect(cover.status).toBe(200);

    const asset = await uploadAsset("owner-meta.wav");
    const created = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(created.status).toBe(201);

    type Owner = {
      trackId: number;
      title: string;
      artists: string[];
      album: string | null;
      collectionId: number | null;
      projectId: number | null;
      artwork: { assetPath: string } | null;
    };
    const expectOwner = (owner: Owner | null) => {
      expect(owner).not.toBeNull();
      expect(owner!.trackId).toBe(trackId);
      expect(owner!.title).toBe("Owner Meta Track");
      expect(owner!.artists).toEqual(["A"]);
      expect(owner!.album).toBe("Owner Meta Collection");
      expect(owner!.collectionId).toBe(collectionId);
      expect(owner!.projectId).toBe(suite.projectId);
      expect(owner!.artwork?.assetPath).toBe(image.assetPath);
    };

    // The link response and the listing agree, so playback started straight
    // after a link is described the same way as playback from the track page.
    const createdAudios = await linkedAudios<{ owner: Owner | null }>(created);
    expectOwner(createdAudios[0]!.owner);

    const listed = (await (
      await request("owner", `/tracks/${trackId}/audios`)
    ).json()) as { id: number; owner: Owner | null }[];
    expectOwner(listed[0]!.owner);

    // Setting it primary puts it on the collection's queue endpoint, which
    // describes each row the same way.
    const audioId = listed[0]!.id;
    const primary = await request("owner", `/track-audios/${audioId}/primary`, {
      method: "PATCH",
    });
    expect(primary.status).toBe(200);

    const queue = (await (
      await request("owner", `/collections/${collectionId}/audios/primary`)
    ).json()) as { trackId: number; owner: Owner | null }[];
    expectOwner(queue.find((r) => r.trackId === trackId)!.owner);
  });

  it("candidate audios union track and session attachments, newest first", async () => {
    requireProject();
    const trackId = await mkTrack("Candidate Track");

    const t = Date.parse("2026-06-01T00:00:00.000Z");
    const day = 86_400_000;

    const trackAudioAsset = await uploadAsset("track-att.wav", {
      localFileCreatedAt: String(t + 2 * day),
    });
    const sessionAudioAsset = await uploadAsset("session-att.wav", {
      localFileCreatedAt: String(t + day),
    });
    const nonAudioAsset = await uploadAsset("cover.jpeg", {
      localFileCreatedAt: String(t + 3 * day),
    });

    for (const assetId of [trackAudioAsset.id, nonAudioAsset.id]) {
      const res = await request("owner", `/tracks/${trackId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ assetId }),
      });
      expect(res.status).toBe(201);
    }

    const session = await mkSession({ trackId });
    const sessAtt = await request(
      "owner",
      `/sessions/${session.id}/attachments`,
      {
        method: "POST",
        body: JSON.stringify({ assetId: sessionAudioAsset.id }),
      }
    );
    expect(sessAtt.status).toBe(201);

    // Link the track's own attachment so the candidate row carries trackAudio.
    await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [trackAudioAsset.id] }),
    });

    const res = await request("owner", `/tracks/${trackId}/candidate-audios`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      id: number;
      trackAudio: { version: number; isPrimary: boolean } | null;
    }[];

    // Non-audio attachment excluded; both audio sources present, newest first.
    expect(rows.map((r) => r.id)).toEqual([
      trackAudioAsset.id,
      sessionAudioAsset.id,
    ]);
    expect(
      rows.find((r) => r.id === trackAudioAsset.id)!.trackAudio
    ).toMatchObject({ version: 1, isPrimary: true });
    expect(
      rows.find((r) => r.id === sessionAudioAsset.id)!.trackAudio
    ).toBeNull();
  });

  it("returns one primary audio per collection track in track-number order", async () => {
    requireProject();
    const collectionId = await mkCollection("Playable Collection");

    const trackA = await mkTrack("Playable A");
    const trackB = await mkTrack("Playable B");
    const trackC = await mkTrack("Playable C"); // no primary audio -> omitted

    const assetA = await uploadAsset("primary-a.wav");
    const assetB = await uploadAsset("primary-b.wav");

    for (const [trackId, assetId] of [
      [trackA, assetA.id],
      [trackB, assetB.id],
    ] as const) {
      const res = await request("owner", `/tracks/${trackId}/audios`, {
        method: "POST",
        body: JSON.stringify({ assetIds: [assetId], primaryAssetId: assetId }),
      });
      expect(res.status).toBe(201);
    }

    for (const [trackId, trackNumber] of [
      [trackB, 1],
      [trackA, 2],
      [trackC, 3],
    ] as const) {
      const res = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ trackId, trackNumber }),
        }
      );
      expect(res.status).toBe(200);
    }

    const res = await request(
      "viewer",
      `/collections/${collectionId}/audios/primary`
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      id: number;
      trackId: number;
      trackAudio: { id: number; version: number; isPrimary: boolean };
    }[];
    expect(rows.map((r) => r.trackId)).toEqual([trackB, trackA]);
    expect(rows.map((r) => r.id)).toEqual([assetB.id, assetA.id]);
    for (const r of rows) {
      expect(r.trackAudio.version).toBe(1);
      expect(r.trackAudio.isPrimary).toBe(true);
      expect(r.trackAudio.id).toBeTypeOf("number");
    }
  });

  it("picks each collection track's primary or latest version by the version query", async () => {
    requireProject();
    const collectionId = await mkCollection("Versioned Collection");
    const withPrimary = await mkTrack("Versioned With Primary");
    const withoutPrimary = await mkTrack("Versioned Without Primary");

    const assets: Record<string, { id: number }> = {};
    for (const [trackId, name] of [
      [withPrimary, "wp"],
      [withoutPrimary, "np"],
    ] as const) {
      const v1 = await uploadAsset(`${name}-v1.wav`);
      const v2 = await uploadAsset(`${name}-v2.wav`);
      assets[`${name}1`] = v1;
      assets[`${name}2`] = v2;
      const res = await request("owner", `/tracks/${trackId}/audios`, {
        method: "POST",
        body: JSON.stringify({
          assetIds: [v1.id, v2.id],
          primaryAssetId: v1.id,
        }),
      });
      expect(res.status).toBe(201);

      const added = await request(
        "owner",
        `/collections/${collectionId}/tracks`,
        { method: "POST", body: JSON.stringify({ trackId }) }
      );
      expect(added.status).toBe(200);
    }
    await db
      .update(trackAudios)
      .set({ isPrimary: false })
      .where(eq(trackAudios.trackId, withoutPrimary));

    const picked = async (query: string) => {
      const res = await request(
        "viewer",
        `/collections/${collectionId}/audios/primary${query}`
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as { id: number; trackId: number }[];
      return new Map(rows.map((r) => [r.trackId, r.id]));
    };

    for (const query of ["", "?version=primary"]) {
      const rows = await picked(query);
      expect(rows.get(withPrimary)).toBe(assets["wp1"]!.id);
      expect(rows.get(withoutPrimary)).toBe(assets["np2"]!.id);
    }

    const latest = await picked("?version=latest");
    expect(latest.get(withPrimary)).toBe(assets["wp2"]!.id);
    expect(latest.get(withoutPrimary)).toBe(assets["np2"]!.id);
  });

  it("rejects a version that is neither primary nor latest", async () => {
    requireProject();
    const collectionId = await mkCollection("Bad Version Collection");
    const res = await request(
      "viewer",
      `/collections/${collectionId}/audios/primary?version=oldest`
    );
    expect(res.status).toBe(400);
  });

  it("gates track-audio endpoints by role", async () => {
    requireProject();
    const trackId = await mkTrack("Gated Audio Track");
    const asset = await uploadAsset("gated-audio.wav");

    await expectAccess(
      "POST",
      `/tracks/${trackId}/audios`,
      { viewer: 403, editor: 201 },
      { assetIds: [asset.id] }
    );

    const [audio] = (await (
      await request("owner", `/tracks/${trackId}/audios`)
    ).json()) as { id: number }[];

    await expectAccess("PATCH", `/track-audios/${audio!.id}/primary`, {
      viewer: 403,
      editor: 200,
    });
    await expectAccess("DELETE", `/track-audios/${audio!.id}`, {
      viewer: 403,
      editor: 204,
    });
  });

  it("serves every registered measure once analysis has run, and 404s while it is outstanding", async () => {
    requireProject();
    const trackId = await mkTrack("Measures Track");
    const asset = await uploadAsset("measures.wav");

    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(linked.status).toBe(201);
    const [audio] = await linkedAudios<{ id: number }>(linked);

    // The uploaded placeholder is a header with no audio behind it, so
    // linking queues an analysis that fails, and every measure 404s while
    // it's outstanding — the 404 is what (re-)queues it.
    await settleSubjectJobs("audio_analysis", [audio!.id]);
    const before = await request(
      "viewer",
      `/track-audios/${audio!.id}/measures/sections`
    );
    expect(before.status).toBe(404);

    await makeAudible(asset.assetPath);
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(eq(jobs.kind, "audio_analysis"), eq(jobs.subjectId, audio!.id))
      );
    await db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, job!.id));
    await request("owner", `/jobs/${job!.id}/retry`, { method: "POST" });
    await settleJobs([job!.id]);

    for (const measure of [
      "peaks",
      "spectrum",
      "sections",
      "loudnessCurve",
      "correlationCurve",
      "clipping",
      "pitchTrack",
    ] as const) {
      const res = await request(
        "viewer",
        `/track-audios/${audio!.id}/measures/${measure}`
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { value: unknown };
      // `spectrum` answers `{hz, db}`; every other measure answers an array.
      if (measure === "spectrum") {
        expect(body.value).toMatchObject({ hz: expect.any(Array) });
      } else {
        expect(Array.isArray(body.value)).toBe(true);
      }
    }
  });

  it("400s a measures request for a name outside the registry", async () => {
    requireProject();
    const trackId = await mkTrack("Unknown Measure Track");
    const asset = await uploadAsset("unknown-measure.wav");
    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    const [audio] = await linkedAudios<{ id: number }>(linked);

    const res = await request(
      "viewer",
      `/track-audios/${audio!.id}/measures/bogus`
    );
    expect(res.status).toBe(400);
  });

  it("queues a fresh analysis when a measures request 404s on an outstanding row with no job pending", async () => {
    requireProject();
    const trackId = await mkTrack("Requeue Track");
    const asset = await uploadAsset("requeue.wav");
    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    const [audio] = await linkedAudios<{ id: number }>(linked);
    await settleSubjectJobs("audio_analysis", [audio!.id]);

    // Put the row back to outstanding and drop the job the link queued, so
    // the only way another one can exist afterward is the measures route
    // queueing it.
    await db
      .update(trackAudios)
      .set({ analysisVersion: null })
      .where(eq(trackAudios.id, audio!.id));
    await db
      .delete(jobs)
      .where(
        and(eq(jobs.kind, "audio_analysis"), eq(jobs.subjectId, audio!.id))
      );

    const res = await request(
      "viewer",
      `/track-audios/${audio!.id}/measures/sections`
    );
    expect(res.status).toBe(404);

    const [job] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(
        and(eq(jobs.kind, "audio_analysis"), eq(jobs.subjectId, audio!.id))
      );
    expect(job).toBeDefined();
    expect(["queued", "running"]).toContain(job!.status);
  });

  describe("where the project does not analyse automatically", () => {
    const onRequest = { audio: { autoAnalyse: false } };

    const analysisJobs = (audioId: number) =>
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(eq(jobs.kind, "audio_analysis"), eq(jobs.subjectId, audioId))
        );

    /** Links a real tone to a fresh track and answers its version and the jobs the link queued. */
    async function linkTone(name: string) {
      const trackId = await mkTrack(`${name} Track`);
      const asset = await uploadAsset(`${name}.wav`);
      await makeAudible(asset.assetPath);
      const res = await request("owner", `/tracks/${trackId}/audios`, {
        method: "POST",
        body: JSON.stringify({ assetIds: [asset.id] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        audios: { id: number }[];
        analysisJobIds: number[];
      };
      return { audioId: body.audios[0]!.id, jobIds: body.analysisJobIds };
    }

    it("queues nothing on link, and analyses a version when an editor asks", async () => {
      requireProject();
      await withProjectPolicyForTest(suite.projectId, onRequest, async () => {
        const { audioId, jobIds } = await linkTone("analyse-now");
        expect(jobIds).toEqual([]);
        expect(await analysisJobs(audioId)).toEqual([]);

        await expectAccess("POST", `/track-audios/${audioId}/analysis`, {
          viewer: 403,
          editor: 202,
        });
        const queued = await request(
          "owner",
          `/track-audios/${audioId}/analysis`,
          { method: "POST" }
        );
        expect(queued.status).toBe(202);
        await settleJobs([((await queued.json()) as { jobId: number }).jobId]);

        const measure = await request(
          "viewer",
          `/track-audios/${audioId}/measures/sections`
        );
        expect(measure.status).toBe(200);
      });
    });

    it("still queues the analysis a measure's 404 asks for", async () => {
      requireProject();
      await withProjectPolicyForTest(suite.projectId, onRequest, async () => {
        const { audioId } = await linkTone("measure-requeue");

        const measure = await request(
          "viewer",
          `/track-audios/${audioId}/measures/sections`
        );
        expect(measure.status).toBe(404);
        expect(await analysisJobs(audioId)).toHaveLength(1);
      });
    });
  });

  it("writes a spectrogram PNG that the static route serves, gated on the project", async () => {
    requireProject();
    const trackId = await mkTrack("Spectrogram Track");
    const asset = await uploadAsset("spectrogram.wav");
    await makeAudible(asset.assetPath);

    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    const [audio] = await linkedAudios<{ id: number }>(linked);
    await settleSubjectJobs("audio_analysis", [audio!.id]);

    const [row] = await db
      .select({ spectrogramKey: trackAudios.spectrogramKey })
      .from(trackAudios)
      .where(eq(trackAudios.id, audio!.id));
    expect(row?.spectrogramKey).toBeTruthy();

    const served = await app.request(servedAt(row!.spectrogramKey!), {
      headers: { Cookie: owner.cookie },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");

    const outsiderRes = await app.request(servedAt(row!.spectrogramKey!), {
      headers: { Cookie: outsider.cookie },
    });
    expect(outsiderRes.status).toBe(403);
  });

  it("answers the diff route once a comparison is stored, and 404s an unstored pair", async () => {
    requireProject();
    const trackId = await mkTrack("Diff Route Track");

    const first = await uploadAsset("diff-route-1.wav");
    await makeAudible(first.assetPath);
    const linked1 = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [first.id] }),
    });
    const [audio1] = await linkedAudios<{ id: number }>(linked1);
    await settleSubjectJobs("audio_analysis", [audio1!.id]);

    const second = await uploadAsset("diff-route-2.wav");
    await makeAudible(second.assetPath);
    const linked2 = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [second.id] }),
    });
    const audios2 = await linkedAudios<{ id: number; assetId: number }>(
      linked2
    );
    const audio2 = audios2.find((a) => a.assetId === second.id)!;
    await settleSubjectJobs("audio_analysis", [audio2.id]);

    const missing = await request(
      "viewer",
      `/track-audios/${audio1!.id}/diff/999999999`
    );
    expect(missing.status).toBe(404);

    const res = await request(
      "viewer",
      `/track-audios/${audio1!.id}/diff/${audio2.id}`
    );
    expect(res.status).toBe(200);
    const diff = (await res.json()) as { fromId: number; toId: number };
    expect(diff.fromId).toBe(audio1!.id);
    expect(diff.toId).toBe(audio2.id);
  });

  /** Links one audible upload to `trackId` and waits for its analysis; returns the new version's id. */
  async function analysedVersion(trackId: number, name: string) {
    const asset = await uploadAsset(name);
    await makeAudible(asset.assetPath);
    const linked = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    const audios = await linkedAudios<{ id: number; assetId: number }>(linked);
    const id = audios.find((audio) => audio.assetId === asset.id)!.id;
    await settleSubjectJobs("audio_analysis", [id]);
    return id;
  }

  type PairDiff = {
    fromId: number;
    toId: number;
    aligned: boolean;
    offsetMs: number | null;
    change: number[];
    summary: { changedShare: number };
  };

  async function pairDiff(fromId: number, toId: number) {
    return request("viewer", `/track-audios/${fromId}/diff/${toId}`);
  }

  it("answers any pair of analysed versions of one track, stored or computed, in either direction", async () => {
    requireProject();
    const trackId = await mkTrack("Pair Diff Track");
    const v1 = await analysedVersion(trackId, "pair-diff-1.wav");
    const v2 = await analysedVersion(trackId, "pair-diff-2.wav");
    const v3 = await analysedVersion(trackId, "pair-diff-3.wav");

    const [storedRow] = await db
      .select()
      .from(trackAudioDiffs)
      .where(and(eq(trackAudioDiffs.fromId, v1), eq(trackAudioDiffs.toId, v2)));
    expect(storedRow).toBeDefined();

    const stored = await pairDiff(v1, v2);
    expect(stored.status).toBe(200);
    const storedBody = (await stored.json()) as PairDiff;
    expect(storedBody.change).toEqual(storedRow!.change);
    expect(storedBody.offsetMs).toBe(storedRow!.offsetMs);
    expect("id" in storedBody).toBe(false);

    const reversed = await pairDiff(v2, v1);
    expect(reversed.status).toBe(200);
    const reversedBody = (await reversed.json()) as PairDiff;
    expect(reversedBody.fromId).toBe(v2);
    expect(reversedBody.toId).toBe(v1);
    expect(reversedBody.aligned).toBe(storedRow!.aligned);
    expect(reversedBody.offsetMs).toBe(
      storedRow!.offsetMs === null ? null : -storedRow!.offsetMs
    );
    expect(reversedBody.change.length).toBeGreaterThan(0);

    const before = await db.select().from(trackAudioDiffs);
    const computed = await pairDiff(v1, v3);
    expect(computed.status).toBe(200);
    const computedBody = (await computed.json()) as PairDiff;
    expect(computedBody.fromId).toBe(v1);
    expect(computedBody.toId).toBe(v3);
    expect(computedBody.change.length).toBeGreaterThan(0);
    expect(computedBody.summary.changedShare).toBeGreaterThanOrEqual(0);
    // Computed on request, never stored.
    expect(await db.select().from(trackAudioDiffs)).toHaveLength(before.length);
  });

  it("404s a pair whose version has no features yet, and a pair across two tracks", async () => {
    requireProject();
    const trackId = await mkTrack("Pair Diff Unanalysed Track");
    const v1 = await analysedVersion(trackId, "pair-unanalysed-1.wav");
    const v2 = await analysedVersion(trackId, "pair-unanalysed-2.wav");
    const v3 = await analysedVersion(trackId, "pair-unanalysed-3.wav");
    await db
      .delete(trackAudioFeatures)
      .where(eq(trackAudioFeatures.trackAudioId, v3));

    expect((await pairDiff(v1, v3)).status).toBe(404);
    expect((await pairDiff(v3, v1)).status).toBe(404);
    // A stored row still answers without reading features.
    expect((await pairDiff(v1, v2)).status).toBe(200);

    const otherTrackId = await mkTrack("Pair Diff Other Track");
    const elsewhere = await analysedVersion(otherTrackId, "pair-other-1.wav");
    expect((await pairDiff(v1, elsewhere)).status).toBe(404);
    expect((await pairDiff(elsewhere, v1)).status).toBe(404);
  });
});
