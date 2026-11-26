import { eq } from "drizzle-orm";
import { describe, expect, it } from "bun:test";

import { db } from "../db/index.js";
import { jobs } from "../db/schema/jobs.js";
import { trackAudios } from "../db/schema/tracks.js";
import { setupSuite } from "../test/fixtures.js";
import type { SettledJob } from "../test/media.js";
import { makeAudible, settledJob, settleJobs } from "../test/media.js";

const suite = setupSuite("Jobs");
const { requireProject, request, expectAccess, mkTrack, uploadAsset } = suite;

describe("jobs", () => {
  it("queues a duration backfill and reports it finished", async () => {
    requireProject();
    const trackId = await mkTrack("Backfilled Track");
    const asset = await uploadAsset("backfill.wav");
    await makeAudible(asset.assetPath);

    const link = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(link.status).toBe(201);
    await settleJobs((await link.json()).analysisJobIds);

    // Linking already analysed the file to the current version; clearing the
    // stamp back to null is what makes it outstanding for the backfill below.
    await db
      .update(trackAudios)
      .set({ analysisVersion: null })
      .where(eq(trackAudios.assetId, asset.id));

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/audio-backfill`,
      { method: "POST" }
    );
    expect(res.status).toBe(202);

    const { jobId } = (await res.json()) as { jobId: number };
    const job = await settledJob(suite, "owner", jobId);
    expect(job.status).toBe("done");
    expect(job.kind).toBe("audio_backfill");
    expect(job.percent).toBe(100);
    expect(job.result?.analysed).toBeGreaterThan(0);
    expect(job.label).toBe("Analysing project audio");
    expect(job.subjectLabel).toBe(
      `${job.result?.analysed} ${job.result?.analysed === 1 ? "file" : "files"}`
    );
  });

  it("shows a job to the project's members and nobody else", async () => {
    requireProject();
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/audio-backfill`,
      { method: "POST" }
    );
    const { jobId } = (await res.json()) as { jobId: number };
    await settleJobs([jobId]);

    await expectAccess(
      "GET",
      `/jobs/${jobId}`,
      { viewer: 200, owner: 200 },
      undefined,
      (body) => {
        const job = body as { id: number; kind: string };
        expect(job.id).toBe(jobId);
        expect(job.kind).toBe("audio_backfill");
      }
    );
  });

  it("keeps a backfill to the project's admins", async () => {
    requireProject();

    // A backfill probes every audio file in the project, so it asks for admin
    // rather than the editor an ordinary write needs.
    const jobIds: number[] = [];
    await expectAccess(
      "POST",
      `/projects/${suite.projectId}/audio-backfill`,
      { viewer: 403, editor: 403, owner: 202 },
      undefined,
      (body) => {
        const queued = body as { jobId: number };
        expect(queued.jobId).toBeTypeOf("number");
        jobIds.push(queued.jobId);
      }
    );

    await settleJobs(jobIds);
  });

  it("lists a project's jobs, narrowed by status", async () => {
    requireProject();
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/audio-backfill`,
      { method: "POST" }
    );
    const { jobId } = (await res.json()) as { jobId: number };
    await settleJobs([jobId]);

    const done = await request(
      "viewer",
      `/projects/${suite.projectId}/jobs?status=done`
    );
    expect(done.status).toBe(200);

    const rows = (await done.json()) as SettledJob[];
    expect(rows.every((job) => job.status === "done")).toBe(true);
    expect(rows.some((job) => job.id === jobId)).toBe(true);
    // Newest first, so the job just queued leads the list.
    expect(rows[0]!.id).toBe(jobId);
  });

  it("lets an editor clear the project's failed jobs", async () => {
    requireProject();
    const [failed] = await db
      .insert(jobs)
      .values({
        projectId: suite.projectId,
        kind: "convert",
        status: "failed",
        error: "ffmpeg: Permission denied",
      })
      .returning({ id: jobs.id });

    const listed = await request(
      "viewer",
      `/projects/${suite.projectId}/jobs?status=failed`
    );
    const before = (await listed.json()) as SettledJob[];
    expect(before.some((job) => job.id === failed!.id)).toBe(true);

    // The viewer's 403 runs first and must leave the row in place for the
    // editor's call to remove.
    await expectAccess(
      "DELETE",
      `/projects/${suite.projectId}/jobs/failed`,
      { viewer: 403, editor: 200, owner: 200 },
      undefined,
      (body, caller) => {
        if (caller !== "editor") return;
        expect((body as { deleted: number }).deleted).toBe(1);
      }
    );

    const after = await request(
      "viewer",
      `/projects/${suite.projectId}/jobs?status=failed`
    );
    expect((await after.json()) as SettledJob[]).toEqual([]);
  });

  it("clearing with nothing failed answers zero", async () => {
    requireProject();
    const res = await request(
      "editor",
      `/projects/${suite.projectId}/jobs/failed`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { deleted: number }).toEqual({ deleted: 0 });
  });

  it("lets an editor cancel a queued job, and refuses one that has finished", async () => {
    requireProject();
    const [queued] = await db
      .insert(jobs)
      .values({ projectId: suite.projectId, kind: "convert", status: "queued" })
      .returning({ id: jobs.id });

    await expectAccess(
      "POST",
      `/jobs/${queued!.id}/cancel`,
      { viewer: 403, editor: 200 },
      undefined,
      (body) => {
        expect(body).toMatchObject({
          id: queued!.id,
          status: "cancelled",
          label: "Converting",
        });
      }
    );

    const again = await request("owner", `/jobs/${queued!.id}/cancel`, {
      method: "POST",
    });
    expect(again.status).toBe(409);

    const missing = await request("owner", `/jobs/2147483647/cancel`, {
      method: "POST",
    });
    expect(missing.status).toBe(404);
  });
});
