import { eq } from "drizzle-orm";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { ANALYSIS_VERSION } from "@workspace/dsp/version";
import { waitFor } from "@workspace/test/wait-for";
import { variantPath, VARIANT_WIDTHS } from "../../lib/images.js";
import { mediaQueue } from "../../lib/jobs.js";
import { storedFilePath } from "../../lib/storage.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { images } from "../schema/images.js";
import { jobs } from "../schema/jobs.js";
import { projects } from "../schema/projects.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import { seedScale } from "../../test/priority.js";
import { withDefaultLevel } from "./priority-levels.js";

/**
 * `queueOutstandingJobs` scans every project's rows with no filter of its
 * own, exactly like `resumeInterruptedJobs`/`pruneFinishedJobs` — this file
 * runs in the suite's `--isolate` pass (`package.json`'s `test` script)
 * alongside `jobs.test.ts` so a project another file left mid-run cannot be
 * mistaken for outstanding work. `decodeInto` is mocked outright (not a
 * call-through spy): these tests are about which subjects the finder decides
 * are outstanding, not what a real decode produces, and a frame count of 0
 * lets `analyseTrackAudio` finish without ever needing a real file.
 */
const media = { decodeInto: mock(async () => 0) };

const actualMedia = { ...(await import("../../lib/media.js")) };
mock.module("../../lib/media.js", () => ({ ...actualMedia, ...media }));

process.env.JOB_RETRY_DELAY_MS = "5";

const { getProjectJobs, queueOutstandingJobs } = await import("./jobs.js");
const { withProjectPolicyForTest } = await import("./project-policy.js");

// Importing the modules that own `audio_backfill` and `image_variants`
// registers their handlers and outstanding-work finders.
await import("./track-audios.js");
await import("./images.js");

async function mkProjectImage(
  projectId: number,
  {
    onDisk = true,
    variantsReady = false,
  }: { onDisk?: boolean; variantsReady?: boolean } = {}
) {
  const assetPath = `images/jobs-outstanding-${projectId}.png`;
  if (onDisk) await mkStoredFile(assetPath);

  const [image] = await db
    .insert(images)
    .values({
      name: "outstanding.png",
      type: "image/png",
      size: 0,
      assetPath,
      projectId,
      scope: "project",
      variantsReady,
    })
    .returning({ id: images.id });
  return { id: image!.id, assetPath };
}

async function mkProject(name: string) {
  const [project] = await db
    .insert(projects)
    .values({ name })
    .returning({ id: projects.id });
  await seedScale(project!.id);
  return project!.id;
}

const storedFiles: string[] = [];

/** Writes an empty stored file for `key`, removed again after the suite. */
async function mkStoredFile(key: string) {
  const file = storedFilePath(key);
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, "");
  storedFiles.push(file);
}

/**
 * A track audio at a given analysis version — null (never analysed) or a
 * version behind `ANALYSIS_VERSION` are both outstanding; `ANALYSIS_VERSION`
 * itself is current.
 */
async function mkAudio(
  projectId: number,
  {
    analysisVersion,
    onDisk = true,
  }: { analysisVersion: number | null; onDisk?: boolean }
) {
  const assetPath = `assets/jobs-outstanding-${projectId}.wav`;
  if (onDisk) await mkStoredFile(assetPath);

  const [track] = await db
    .insert(tracks)
    .values(
      await withDefaultLevel({ title: "Outstanding", artists: [], projectId })
    )
    .returning({ id: tracks.id });

  const [asset] = await db
    .insert(assets)
    .values({
      name: `outstanding-${projectId}.wav`,
      type: "audio/wav",
      size: 0,
      assetPath,
      projectId,
    })
    .returning({ id: assets.id });

  await db.insert(trackAudios).values({
    trackId: track!.id,
    assetId: asset!.id,
    version: 1,
    analysisVersion,
  });
}

const projectIds: number[] = [];
const variantFiles: string[] = [];

beforeEach(() => {
  media.decodeInto.mockClear();
});

afterAll(async () => {
  await mediaQueue.idle();
  for (const id of projectIds) {
    await db.delete(projects).where(eq(projects.id, id));
  }
  await Promise.all(
    [...variantFiles, ...storedFiles].map((file) => rm(file, { force: true }))
  );
});

describe("queueOutstandingJobs", () => {
  it("queues an audio_backfill for a project with an unanalysed audio, not for one at the current version", async () => {
    const incomplete = await mkProject(`Outstanding Incomplete ${Date.now()}`);
    const complete = await mkProject(`Outstanding Complete ${Date.now()}`);
    projectIds.push(incomplete, complete);

    await mkAudio(incomplete, { analysisVersion: null });
    await mkAudio(complete, { analysisVersion: ANALYSIS_VERSION });

    await queueOutstandingJobs();

    const incompleteJobs = await getProjectJobs(incomplete);
    expect(incompleteJobs.some((job) => job.kind === "audio_backfill")).toBe(
      true
    );

    const completeJobs = await getProjectJobs(complete);
    expect(completeJobs.some((job) => job.kind === "audio_backfill")).toBe(
      false
    );
  });

  it("queues no audio_backfill for a project that does not analyse automatically", async () => {
    const project = await mkProject(`Outstanding On Request ${Date.now()}`);
    projectIds.push(project);
    await mkAudio(project, { analysisVersion: null });

    await withProjectPolicyForTest(
      project,
      { audio: { autoAnalyse: false } },
      queueOutstandingJobs
    );

    const skipped = await getProjectJobs(project);
    expect(skipped.some((job) => job.kind === "audio_backfill")).toBe(false);

    await queueOutstandingJobs();
    const queued = await getProjectJobs(project);
    expect(queued.some((job) => job.kind === "audio_backfill")).toBe(true);
  });

  it("queues an audio_backfill for a project whose audio has fallen behind ANALYSIS_VERSION", async () => {
    const project = await mkProject(`Outstanding Stale ${Date.now()}`);
    projectIds.push(project);
    await mkAudio(project, { analysisVersion: ANALYSIS_VERSION - 1 });

    await queueOutstandingJobs();

    const queued = await getProjectJobs(project);
    expect(queued.some((job) => job.kind === "audio_backfill")).toBe(true);
  });

  it("does not queue a second audio_backfill for a project that already has one in flight", async () => {
    const project = await mkProject(`Outstanding Duplicate ${Date.now()}`);
    projectIds.push(project);
    await mkAudio(project, { analysisVersion: null });

    await queueOutstandingJobs();
    await waitFor(async () => {
      const running = await getProjectJobs(project);
      expect(running.some((job) => job.kind === "audio_backfill")).toBe(true);
    });

    // A second pass sees the same project still has outstanding audio, but
    // `enqueueJobsOnce` finds the job already in flight and queues nothing.
    await queueOutstandingJobs();

    const backfills = (await getProjectJobs(project)).filter(
      (job) => job.kind === "audio_backfill"
    );
    expect(backfills).toHaveLength(1);
  });

  it("queues an image_variants job for an image whose resizes are not recorded", async () => {
    const withMissingVariant = await mkProject(
      `Outstanding Image Missing ${Date.now()}`
    );
    const withEveryVariant = await mkProject(
      `Outstanding Image Complete ${Date.now()}`
    );
    projectIds.push(withMissingVariant, withEveryVariant);

    const missing = await mkProjectImage(withMissingVariant);
    // `variantsReady` is the record of the resizes being written, so it — not
    // a stat of four files — is what makes an image finished work.
    const complete = await mkProjectImage(withEveryVariant, {
      variantsReady: true,
    });

    // Whatever the queued job writes is cleaned up with the rest.
    for (const width of VARIANT_WIDTHS) {
      variantFiles.push(variantPath(missing.assetPath, width));
    }

    await queueOutstandingJobs();

    const missingJobs = await getProjectJobs(withMissingVariant);
    expect(
      missingJobs.some(
        (job) => job.kind === "image_variants" && job.subjectId === missing.id
      )
    ).toBe(true);

    const completeJobs = await getProjectJobs(withEveryVariant);
    expect(
      completeJobs.some(
        (job) => job.kind === "image_variants" && job.subjectId === complete.id
      )
    ).toBe(false);
  });

  it("queues nothing for an image or audio whose stored file is gone", async () => {
    const project = await mkProject(`Outstanding Gone ${Date.now()}`);
    projectIds.push(project);

    await mkProjectImage(project, { onDisk: false });
    await mkAudio(project, { analysisVersion: null, onDisk: false });

    await queueOutstandingJobs();

    expect(await getProjectJobs(project)).toHaveLength(0);
  });

  it("does not queue a subject again once a job of that kind failed", async () => {
    const project = await mkProject(`Outstanding Failed ${Date.now()}`);
    projectIds.push(project);
    const image = await mkProjectImage(project);

    await db.insert(jobs).values({
      projectId: project,
      kind: "image_variants",
      subjectId: image.id,
      status: "failed",
      error: "Input file is corrupt",
      finishedAt: new Date(),
    });

    await queueOutstandingJobs();

    expect(await getProjectJobs(project)).toHaveLength(1);
  });

  it("does not queue an audio_backfill again once one finished leaving rows outstanding", async () => {
    const project = await mkProject(`Outstanding Unmeasurable ${Date.now()}`);
    projectIds.push(project);
    await mkAudio(project, { analysisVersion: null });

    await db.insert(jobs).values({
      projectId: project,
      kind: "audio_backfill",
      subjectId: project,
      status: "done",
      finishedAt: new Date(),
    });

    await queueOutstandingJobs();

    expect(await getProjectJobs(project)).toHaveLength(1);
  });
});
