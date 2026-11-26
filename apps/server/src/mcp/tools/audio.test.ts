import { rm } from "node:fs/promises";
import { describe, expect, it, setSystemTime } from "bun:test";
import { db } from "../../db/index.js";
import { withDefaultLevel } from "../../db/queries/priority-levels.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { sessionAttachments } from "../../db/schema/attachments.js";
import { jobs } from "../../db/schema/jobs.js";
import { sessions } from "../../db/schema/sessions.js";
import { onDiskPath, setupSuite } from "../../test/fixtures.js";
import { makeAudible, settledJob, settleJobs } from "../../test/media.js";
import { callTool, listToolNames, mintMcpToken } from "../../test/mcp.js";

type JsonRpcResult<T> = {
  result?: {
    isError?: boolean;
    content?: { text: string }[];
    structuredContent?: T;
  };
};

const suite = setupSuite("MCP audio tools");
const {
  owner,
  viewer,
  outsider,
  requireProject,
  requestAs,
  mkTrack,
  mkSession,
  uploadAsset,
} = suite;

/** Links the asset and answers the ids of the analysis jobs it queued. */
async function linkAsset(trackId: number, assetId: number): Promise<number[]> {
  const res = await requestAs(owner, `/tracks/${trackId}/audios`, {
    method: "POST",
    body: JSON.stringify({ assetIds: [assetId] }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { analysisJobIds: number[] }).analysisJobIds;
}

describe("audit_audio", () => {
  it("returns the findings the read produces, scoped to trackIds when given", async () => {
    requireProject();
    const trackId = await mkTrack("Audited Track");

    const real = await uploadAsset("real.wav");
    await makeAudible(real.assetPath);
    await settleJobs(await linkAsset(trackId, real.id));

    const outstanding = await uploadAsset("outstanding.wav");
    await settleJobs(await linkAsset(trackId, outstanding.id));

    const missingTrackId = await mkTrack("Missing File Track");
    const missing = await uploadAsset("missing.wav");
    await settleJobs(await linkAsset(missingTrackId, missing.id));
    await rm(onDiskPath(missing.assetPath));

    const token = await mintMcpToken(owner, ["read"]);

    const full = await callTool(token, "audit_audio", {
      projectId: suite.projectId,
    });
    expect(full.status).toBe(200);
    const fullBody = full.body as JsonRpcResult<{
      tracks: { trackId: number }[];
      findings: { code: string; trackId: number }[];
    }>;
    const fullContent = fullBody.result!.structuredContent!;
    expect(fullContent.tracks.some((t) => t.trackId === trackId)).toBe(true);
    expect(
      fullContent.findings.some(
        (f) => f.code === "analysis_outstanding" && f.trackId === trackId
      )
    ).toBe(true);
    expect(
      fullContent.findings.some(
        (f) => f.code === "missing_file" && f.trackId === missingTrackId
      )
    ).toBe(true);

    const scoped = await callTool(token, "audit_audio", {
      projectId: suite.projectId,
      trackIds: [trackId],
    });
    const scopedBody = scoped.body as JsonRpcResult<{
      tracks: { trackId: number }[];
    }>;
    expect(
      scopedBody.result!.structuredContent!.tracks.map((t) => t.trackId)
    ).toEqual([trackId]);
  });

  it("lets a project viewer read and answers an outsider with an error result", async () => {
    requireProject();

    const viewerToken = await mintMcpToken(suite.viewer, ["read"]);
    const viewerResult = await callTool(viewerToken, "audit_audio", {
      projectId: suite.projectId,
    });
    expect(viewerResult.status).toBe(200);
    const viewerBody = viewerResult.body as JsonRpcResult<unknown>;
    expect(viewerBody.result?.isError).toBeFalsy();

    const outsiderToken = await mintMcpToken(outsider, ["read"]);
    const outsiderResult = await callTool(outsiderToken, "audit_audio", {
      projectId: suite.projectId,
    });
    expect(outsiderResult.status).toBe(200);
    const outsiderBody = outsiderResult.body as JsonRpcResult<unknown>;
    expect(outsiderBody.result?.isError).toBe(true);
    expect(outsiderBody.result?.content?.[0]?.text).toContain("404");
  });
});

describe("get_track_audio_facts", () => {
  it("returns the scalar analysis and findings for one track", async () => {
    requireProject();
    const trackId = await mkTrack("Facts Track");
    const asset = await uploadAsset("facts.wav");
    await makeAudible(asset.assetPath);
    await settleJobs(await linkAsset(trackId, asset.id));

    const token = await mintMcpToken(owner, ["read"]);
    const result = await callTool(token, "get_track_audio_facts", {
      trackId,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<{
      trackId: number;
      versions: { analysis: { current: boolean; durationMs: number } }[];
    }>;
    const content = body.result!.structuredContent!;
    expect(content.trackId).toBe(trackId);
    expect(content.versions).toHaveLength(1);
    expect(content.versions[0]!.analysis.current).toBe(true);
    expect(content.versions[0]!.analysis.durationMs).toBeGreaterThan(0);
  });

  it("measures the findings against the project's own audit thresholds", async () => {
    requireProject();
    const trackId = await mkTrack("Threshold Track");
    const asset = await uploadAsset("threshold.wav");
    // Half a second of tone: too short for the default 15 s threshold.
    await makeAudible(asset.assetPath);
    await settleJobs(await linkAsset(trackId, asset.id));

    const token = await mintMcpToken(owner, ["read"]);
    const codes = async () => {
      const result = await callTool(token, "get_track_audio_facts", {
        trackId,
      });
      const body = result.body as JsonRpcResult<{
        findings: { code: string }[];
      }>;
      return body.result!.structuredContent!.findings.map((f) => f.code);
    };

    expect(await codes()).toContain("too_short");
    const lenient = await withProjectPolicyForTest(
      suite.projectId,
      { audio: { auditTooShortSeconds: 0.25 } },
      codes
    );
    expect(lenient).not.toContain("too_short");
  });

  it("answers 404 for a track id that resolves to no row", async () => {
    requireProject();
    const token = await mintMcpToken(owner, ["read"]);
    const result = await callTool(token, "get_track_audio_facts", {
      trackId: 999_999_999,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<unknown>;
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("404");
  });

  it("answers an outsider the same 404 as a nonexistent track id, never 403", async () => {
    requireProject();
    const trackId = await mkTrack("Facts Outsider Track");
    const outsiderToken = await mintMcpToken(outsider, ["read"]);

    const forReal = await callTool(outsiderToken, "get_track_audio_facts", {
      trackId,
    });
    const forMissing = await callTool(outsiderToken, "get_track_audio_facts", {
      trackId: 999_999_999,
    });

    const realBody = forReal.body as JsonRpcResult<unknown>;
    const missingBody = forMissing.body as JsonRpcResult<unknown>;
    expect(realBody.result?.isError).toBe(true);
    expect(missingBody.result?.isError).toBe(true);
    expect(realBody.result?.content?.[0]?.text).toContain("404");
    expect(realBody.result?.content?.[0]?.text).toBe(
      missingBody.result?.content?.[0]?.text
    );
  });

  it("carries the track's main session alongside the detected tempo and key", async () => {
    requireProject();
    const trackId = await mkTrack("Main Session Track");
    const session = await mkSession({
      trackId,
      main: true,
      tempo: "128",
      rootNote: "C",
      scale: "major",
    });
    await suite.mkPrimaryAudioWithLoudness(trackId, -14, undefined, {
      bpm: 129.5,
      musicalKey: "D minor",
    });

    const token = await mintMcpToken(owner, ["read"]);
    const result = await callTool(token, "get_track_audio_facts", {
      trackId,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<{
      mainSession: {
        id: number;
        name: string;
        tempo: number | null;
        rootNote: string | null;
        scale: string | null;
      } | null;
      versions: {
        analysis: { bpm: number | null; musicalKey: string | null };
      }[];
    }>;
    const content = body.result!.structuredContent!;
    expect(content.mainSession).toEqual({
      id: session.id,
      name: "S",
      tempo: 128,
      rootNote: "C",
      scale: "Major",
    });
    expect(content.versions[0]!.analysis.bpm).toBe(129.5);
    expect(content.versions[0]!.analysis.musicalKey).toBe("D minor");
  });

  it("answers null for mainSession when the track has no main session", async () => {
    requireProject();
    const trackId = await mkTrack("No Main Session");
    const token = await mintMcpToken(owner, ["read"]);
    const result = await callTool(token, "get_track_audio_facts", {
      trackId,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<{ mainSession: unknown }>;
    expect(body.result!.structuredContent!.mainSession).toBeNull();
  });
});

describe("list_candidate_audios", () => {
  it("wraps getCandidateAudios' array result in an object", async () => {
    requireProject();
    const trackId = await mkTrack("Candidates Track");
    const [session] = await db
      .insert(sessions)
      .values(
        await withDefaultLevel({
          name: "Candidate Session",
          daw: "Ableton",
          projectId: suite.projectId,
          trackId,
        })
      )
      .returning({ id: sessions.id });

    const candidate = await uploadAsset("candidate.wav");
    await db
      .insert(sessionAttachments)
      .values({ sessionId: session!.id, assetId: candidate.id });

    const token = await mintMcpToken(owner, ["read"]);
    const result = await callTool(token, "list_candidate_audios", {
      trackId,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<{
      candidates: { id: number; trackAudio: null }[];
    }>;
    const content = body.result!.structuredContent!;
    expect(content.candidates.some((c) => c.id === candidate.id)).toBe(true);
    expect(
      content.candidates.find((c) => c.id === candidate.id)?.trackAudio
    ).toBeNull();
  });
});

describe("link_audio_versions", () => {
  it("links the assets, resequences versions and queues analysis reaching done", async () => {
    requireProject();
    const trackId = await mkTrack("Link Track");
    const asset = await uploadAsset("link.wav");
    await makeAudible(asset.assetPath);

    const token = await mintMcpToken(owner, ["read", "write"]);
    const result = await callTool(token, "link_audio_versions", {
      trackId,
      assetIds: [asset.id],
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<{
      audios: { assetId: number; version: number }[];
      analysisJobIds: number[];
    }>;
    const content = body.result!.structuredContent!;
    expect(content.audios.map((a) => a.assetId)).toEqual([asset.id]);
    expect(content.analysisJobIds).toHaveLength(1);

    const job = await settledJob(suite, "owner", content.analysisJobIds[0]!);
    expect(job.status).toBe("done");
  });
});

describe("set_primary_audio", () => {
  it("moves the primary to the given version", async () => {
    requireProject();
    const trackId = await mkTrack("Primary Track");
    const first = await uploadAsset("first.wav");
    const second = await uploadAsset("second.wav");
    await linkAsset(trackId, first.id);
    await linkAsset(trackId, second.id);

    const audiosRes = await requestAs(owner, `/tracks/${trackId}/audios`);
    const audios = (await audiosRes.json()) as {
      id: number;
      assetId: number;
      isPrimary: boolean;
    }[];
    const target = audios.find((a) => a.assetId === first.id)!;

    const token = await mintMcpToken(owner, ["read", "write"]);
    const result = await callTool(token, "set_primary_audio", {
      trackAudioId: target.id,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<unknown>;
    expect(body.result?.isError).toBeFalsy();

    const after = (await (
      await requestAs(owner, `/tracks/${trackId}/audios`)
    ).json()) as { id: number; isPrimary: boolean }[];
    expect(after.find((a) => a.id === target.id)?.isPrimary).toBe(true);
  });
});

describe("unlink_audio_version", () => {
  it("removes the version and resequences the rest", async () => {
    requireProject();
    const trackId = await mkTrack("Unlink Track");
    const first = await uploadAsset("unlink-a.wav");
    const second = await uploadAsset("unlink-b.wav");
    await linkAsset(trackId, first.id);
    await linkAsset(trackId, second.id);

    const before = (await (
      await requestAs(owner, `/tracks/${trackId}/audios`)
    ).json()) as { id: number; assetId: number; version: number }[];
    const target = before.find((a) => a.assetId === first.id)!;
    const remaining = before.find((a) => a.assetId === second.id)!;

    const token = await mintMcpToken(owner, ["read", "write"]);
    const result = await callTool(token, "unlink_audio_version", {
      trackAudioId: target.id,
    });
    expect(result.status).toBe(200);
    const body = result.body as JsonRpcResult<unknown>;
    expect(body.result?.isError).toBeFalsy();

    const after = (await (
      await requestAs(owner, `/tracks/${trackId}/audios`)
    ).json()) as { id: number; version: number }[];
    expect(after.map((a) => a.id)).toEqual([remaining.id]);
    expect(after[0]!.version).toBe(1);
  });

  it("is absent from tools/list for a read-only token", async () => {
    requireProject();
    const readToken = await mintMcpToken(owner, ["read"]);
    const names = await listToolNames(readToken);
    expect(names).not.toContain("unlink_audio_version");
  });
});

describe("queue_backfill", () => {
  it("answers 403 for a project viewer and 429 for the sixth call in a burst", async () => {
    requireProject();

    const viewerToken = await mintMcpToken(viewer, ["read", "write"]);
    const viewerResult = await callTool(viewerToken, "queue_backfill", {
      projectId: suite.projectId,
    });
    expect(viewerResult.status).toBe(200);
    const viewerBody = viewerResult.body as JsonRpcResult<unknown>;
    expect(viewerBody.result?.isError).toBe(true);
    expect(viewerBody.result?.content?.[0]?.text).toContain("403");

    const ownerToken = await mintMcpToken(owner, ["read", "write"]);
    // The bucket refills against the clock, so a burst that takes more than
    // a moment on a busy machine would earn its sixth call back. Holding the
    // clock still makes the burst instantaneous as far as the bucket knows.
    setSystemTime(new Date());
    let last: { status: number; body: unknown } = { status: 0, body: null };
    try {
      for (let i = 0; i < 6; i += 1) {
        last = await callTool(ownerToken, "queue_backfill", {
          projectId: suite.projectId,
        });
      }
    } finally {
      setSystemTime();
    }
    expect(last.status).toBe(200);
    const lastBody = last.body as JsonRpcResult<unknown>;
    expect(lastBody.result?.isError).toBe(true);
    expect(lastBody.result?.content?.[0]?.text).toContain("429");
  });
});

describe("cancel_job", () => {
  it("cancels a queued backfill and answers 409 for a job already finished", async () => {
    requireProject();
    const token = await mintMcpToken(owner, ["read", "write"]);

    // Inserted directly, not through `queue_backfill`, so the row never
    // reaches `mediaQueue` and stays `queued` for the cancel to catch.
    const [queued] = await db
      .insert(jobs)
      .values({
        projectId: suite.projectId,
        kind: "audio_backfill",
        status: "queued",
      })
      .returning({ id: jobs.id });
    const jobId = queued!.id;

    const cancelled = await callTool(token, "cancel_job", { jobId });
    const cancelledBody = cancelled.body as JsonRpcResult<{ status: string }>;
    expect(cancelledBody.result?.isError).toBeFalsy();
    expect(cancelledBody.result?.structuredContent?.status).toBe("cancelled");

    const [done] = await db
      .insert(jobs)
      .values({
        projectId: suite.projectId,
        kind: "audio_backfill",
        status: "done",
      })
      .returning({ id: jobs.id });

    const finished = await callTool(token, "cancel_job", {
      jobId: done!.id,
    });
    const finishedBody = finished.body as JsonRpcResult<unknown>;
    expect(finishedBody.result?.isError).toBe(true);
    expect(finishedBody.result?.content?.[0]?.text).toContain("409");
  });
});

describe("get_job / list_jobs", () => {
  it("follows a queued job to done and lists it for the project", async () => {
    requireProject();
    const trackId = await mkTrack("Poll Track");
    const asset = await uploadAsset("poll.wav");
    await makeAudible(asset.assetPath);

    const token = await mintMcpToken(owner, ["read", "write"]);
    const linked = await callTool(token, "link_audio_versions", {
      trackId,
      assetIds: [asset.id],
    });
    const linkedBody = linked.body as JsonRpcResult<{
      analysisJobIds: number[];
    }>;
    const jobId = linkedBody.result!.structuredContent!.analysisJobIds[0]!;

    await settledJob(suite, "owner", jobId);

    const job = await callTool(token, "get_job", { jobId });
    const jobBody = job.body as JsonRpcResult<{ status: string }>;
    expect(jobBody.result?.structuredContent?.status).toBe("done");

    const list = await callTool(token, "list_jobs", {
      projectId: suite.projectId,
      status: ["done"],
    });
    const listBody = list.body as JsonRpcResult<{ jobs: { id: number }[] }>;
    expect(
      listBody.result?.structuredContent?.jobs.some((j) => j.id === jobId)
    ).toBe(true);
  });
});
