import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import { gate } from "@workspace/test/gate";
import { waitFor } from "@workspace/test/wait-for";
import { DEFAULT_INSTANCE_POLICY } from "../../lib/instance-policy.js";
import { subscribeProject } from "../../lib/job-events.js";
import { mediaQueue } from "../../lib/jobs.js";
import {
  MediaLimitError,
  MediaTimeoutError,
  type decodeInto as DecodeInto,
} from "../../lib/media.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { type DescribedJob, type Job, jobs } from "../schema/jobs.js";
import { projects } from "../schema/projects.js";
import { trackAudios, tracks } from "../schema/tracks.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { seedScale } from "../../test/priority.js";

/**
 * The jobs under test are audio analysis, so the one spawn it makes is
 * stubbed out: what matters here is how the runner moves a row through its
 * lifecycle, not what ffmpeg decodes. Stubbing it also lets a test hold a
 * handler mid-loop and look at the progress it has written so far.
 */
const media = { decodeInto: mock<typeof DecodeInto>(async () => 0) };

// Copied out before the mock replaces the module's live bindings.
const actualMedia = { ...(await import("../../lib/media.js")) };
mock.module("../../lib/media.js", () => ({ ...actualMedia, ...media }));

// Read at each retry, so a retry fires almost instantly instead of after the
// real 5s/10s delay a production job waits out.
process.env.JOB_RETRY_DELAY_MS = "5";

const {
  MAX_PROJECT_JOBS,
  cancelJob,
  clearFailedJobs,
  enqueueJob,
  getJob,
  getProjectJobs,
  overallPercent,
  pruneFinishedJobs,
  registerJobHandler,
  resumeInterruptedJobs,
  retryJob,
  runJob,
  startJobPruning,
} = await import("./jobs.js");

const DAY_MS = 24 * 60 * 60 * 1000;

// Importing the module that owns them is what registers the handlers.
const { enqueueAudioBackfill } = await import("./track-audios.js");

const AUDIO_COUNT = 3;

const LADDER = [
  { key: "a", label: "First", weight: 2 },
  { key: "b", label: "Second", weight: 5 },
  { key: "c", label: "Third", weight: 3 },
];

let projectId: number;
const trackAudioIds: number[] = [];

/** Every job event the project publishes while `body` runs. */
async function watchingEvents(
  body: (events: DescribedJob[]) => Promise<void>
): Promise<void> {
  const events: DescribedJob[] = [];
  const unsubscribe = subscribeProject(projectId, (job) => events.push(job));
  try {
    await body(events);
  } finally {
    unsubscribe();
  }
}

beforeAll(async () => {
  const [project] = await db
    .insert(projects)
    .values({ name: `Jobs Test ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  const priorityId = await seedScale(projectId);

  const [track] = await db
    .insert(tracks)
    .values({ title: "Jobs", artists: [], projectId, priorityId })
    .returning({ id: tracks.id });

  for (let version = 1; version <= AUDIO_COUNT; version++) {
    const [asset] = await db
      .insert(assets)
      .values({
        name: `job-${version}.wav`,
        type: "audio/wav",
        size: 0,
        assetPath: `./static/assets/jobs-test-${version}.wav`,
        projectId,
      })
      .returning({ id: assets.id });

    const [trackAudio] = await db
      .insert(trackAudios)
      .values({ trackId: track!.id, assetId: asset!.id, version })
      .returning({ id: trackAudios.id });
    trackAudioIds.push(trackAudio!.id);
  }
});

afterAll(async () => {
  await mediaQueue.idle();
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  await mediaQueue.idle();
  await db.delete(jobs).where(eq(jobs.projectId, projectId));
  // A successful `decodeInto` marks a row analysed for good, unlike the old
  // funnel's always-null probes, so every fixture audio is put back to
  // outstanding for the next test to find.
  await db
    .update(trackAudios)
    .set({ analysisVersion: null })
    .where(inArray(trackAudios.id, trackAudioIds));
  media.decodeInto.mockReset().mockResolvedValue(0);
});

describe("the job runner", () => {
  it("returns a queued row and runs it to completion", async () => {
    const job = await enqueueAudioBackfill(projectId);
    expect(job.status).toBe("queued");
    expect(job.percent).toBe(0);
    expect(job.stepIndex).toBeNull();

    await mediaQueue.idle();

    const done = await getJob(job.id);
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({ analysed: AUDIO_COUNT });
    expect(done.percent).toBe(100);
    expect(done.stepIndex).toBe(0);
    expect(done.stepPercent).toBe(100);
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
  });

  it("gives a kind that declares no steps one step named by its label", async () => {
    const job = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();

    expect((await getJob(job.id)).steps).toEqual([
      { key: "run", label: "Analysing project audio", weight: 1 },
    ]);
  });

  it("writes progress through while the job is still running", async () => {
    const held = gate();
    let calls = 0;
    media.decodeInto.mockImplementation(async () => {
      if (++calls === 2) await held.opened;
      return 0;
    });

    const job = await enqueueAudioBackfill(projectId);

    await waitFor(async () => {
      const running = await getJob(job.id);
      expect(running.status).toBe("running");
      expect(running.percent).toBe(33.3);
      expect(running.stepPercent).toBe(33.3);
    });

    held.open();
    await mediaQueue.idle();
    expect((await getJob(job.id)).percent).toBe(100);
  });

  it("fails a job it cannot run without stalling the queue behind it", async () => {
    // No handler is registered for image variants yet.
    const orphan = await enqueueJob({ projectId, kind: "image_variants" });
    const next = await enqueueAudioBackfill(projectId);

    await mediaQueue.idle();

    const failed = await getJob(orphan.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("image_variants");
    expect(failed.finishedAt).not.toBeNull();

    expect((await getJob(next.id)).status).toBe("done");
  });

  it("runs a job once however often it reaches the runner", async () => {
    const job = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();
    expect(media.decodeInto).toHaveBeenCalledTimes(AUDIO_COUNT);

    await runJob(job.id);

    expect(media.decodeInto).toHaveBeenCalledTimes(AUDIO_COUNT);
    expect((await getJob(job.id)).status).toBe("done");
  });

  it("re-queues a job a previous process left running, with its progress reset", async () => {
    const [stranded] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "audio_backfill",
        subjectId: projectId,
        status: "running",
        startedAt: new Date(),
        result: { all: false },
        stepIndex: 0,
        stepPercent: 40,
        percent: 40,
        cancelRequested: true,
      })
      .returning();

    await watchingEvents(async (events) => {
      await resumeInterruptedJobs();
      await mediaQueue.idle();

      expect(events.find((event) => event.status === "queued")).toMatchObject({
        id: stranded!.id,
        stepIndex: null,
        stepPercent: null,
        percent: 0,
        queuePosition: null,
        cancelRequested: false,
      });
    });

    expect((await getJob(stranded!.id)).status).toBe("done");
  });

  it("prunes finished jobs past the retention window and keeps recent ones", async () => {
    const retentionMs = DEFAULT_INSTANCE_POLICY.jobs.jobRetentionDays * DAY_MS;
    const [stale] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "convert",
        status: "done",
        finishedAt: new Date(Date.now() - retentionMs - 60_000),
      })
      .returning({ id: jobs.id });
    const [recent] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "convert",
        status: "done",
        finishedAt: new Date(),
      })
      .returning({ id: jobs.id });

    await pruneFinishedJobs();

    expect(await db.select().from(jobs).where(eq(jobs.id, stale!.id))).toEqual(
      []
    );
    expect(
      await db.select().from(jobs).where(eq(jobs.id, recent!.id))
    ).toHaveLength(1);
  });

  it("prunes to the retention the instance sets", async () => {
    const [twoDaysOld] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "convert",
        status: "done",
        finishedAt: new Date(Date.now() - 2 * DAY_MS),
      })
      .returning({ id: jobs.id });

    stubInstancePolicy({ jobs: { jobRetentionDays: 1 } });
    try {
      await pruneFinishedJobs();
    } finally {
      restoreInstancePolicy();
    }

    expect(
      await db.select().from(jobs).where(eq(jobs.id, twoDaysOld!.id))
    ).toEqual([]);
  });

  it("prunes on a daily timer, and at once when the instance changes the retention", () => {
    jest.useFakeTimers();
    const prune = mock(async () => 0);
    const stop = startJobPruning(prune);
    try {
      jest.advanceTimersByTime(DAY_MS);
      expect(prune).toHaveBeenCalledTimes(1);

      stubInstancePolicy({ jobs: { jobRetentionDays: 3 } });
      expect(prune).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      restoreInstancePolicy();
      jest.useRealTimers();
    }
  });

  it("clears a project's failed jobs and nothing else", async () => {
    const [other] = await db
      .insert(projects)
      .values({ name: `Jobs Clear Other ${Date.now()}` })
      .returning({ id: projects.id });
    const inserted = await db
      .insert(jobs)
      .values([
        { projectId, kind: "convert", status: "failed", error: "boom" },
        { projectId, kind: "convert", status: "failed", error: "boom" },
        { projectId, kind: "convert", status: "done", finishedAt: new Date() },
        { projectId, kind: "convert", status: "queued" },
        { projectId: other!.id, kind: "convert", status: "failed" },
      ])
      .returning({
        id: jobs.id,
        status: jobs.status,
        projectId: jobs.projectId,
      });

    expect(await clearFailedJobs(projectId)).toBe(2);

    const left = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          inserted.map((row) => row.id)
        )
      );
    const kept = inserted.filter(
      (row) => row.status !== "failed" || row.projectId !== projectId
    );
    expect(left.map((row) => row.id).sort()).toEqual(
      kept.map((row) => row.id).sort()
    );

    await db.delete(projects).where(eq(projects.id, other!.id));
  });
});

describe("audio_backfill", () => {
  it("scales each file's decode progress into its share of the whole pass", async () => {
    const gates = [gate(), gate(), gate()];
    let calls = 0;
    media.decodeInto.mockImplementation(async (_path, _session, options) => {
      const index = calls++;
      // 0.9 through the decode step of the file's own nested analysis ladder
      // (decode weight 80 of 100, so 0.72 of the file), so a bug that reports
      // it as 0.9 of the whole pass (90%) or of the file (30%, 63.3%, 96.7%)
      // reads nothing like the correctly nested figures below (24.0, 57.3,
      // 90.7).
      await options?.onProgress?.(0.9);
      await gates[index]!.opened;
      return 0;
    });

    const job = await enqueueAudioBackfill(projectId);

    await waitFor(async () => {
      const running = await getJob(job.id);
      expect(running.status).toBe("running");
      expect(running.percent).toBeCloseTo(24.0, 1);
    });

    gates[0]!.open();
    await waitFor(async () => {
      expect((await getJob(job.id)).percent).toBeCloseTo(57.3, 1);
    });

    gates[1]!.open();
    await waitFor(async () => {
      expect((await getJob(job.id)).percent).toBeCloseTo(90.7, 1);
    });

    gates[2]!.open();
    await mediaQueue.idle();
    expect((await getJob(job.id)).percent).toBe(100);
  });

  it("keeps going past a file whose decode fails, and still analyses the rest", async () => {
    let calls = 0;
    media.decodeInto.mockImplementation(async () => {
      calls++;
      return calls === 2 ? null : 0; // the second file cannot be read
    });

    const job = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();

    const done = await getJob(job.id);
    expect(done.status).toBe("done");
    // No retry of the whole pass: every file was reached once.
    expect(done.attempts).toBe(0);
    expect(media.decodeInto).toHaveBeenCalledTimes(AUDIO_COUNT);
    expect(done.result).toMatchObject({ analysed: AUDIO_COUNT - 1 });
  });
});

describe("step-aware progress", () => {
  it("writes the ladder on claim and derives percent from the step weights", async () => {
    const inStep = gate();
    const halfway = gate();
    const release = gate();
    registerJobHandler(
      "convert",
      async (_job, report) => {
        await report.step("b");
        inStep.open();
        await halfway.opened;
        await report.progress(0.5);
        await release.opened;
      },
      { label: "Converting", steps: LADDER }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    try {
      await inStep.opened;
      const entered = await getJob(job.id);
      expect(entered.steps).toEqual(LADDER);
      expect(entered.stepIndex).toBe(1);
      expect(entered.stepPercent).toBe(0);
      expect(entered.percent).toBe(overallPercent(LADDER, 1, 0));
      expect(entered.percent).toBe(20);

      halfway.open();
      // Half of step b's weight is 2.5 of 10, so 25 points.
      await waitFor(async () => {
        const moved = await getJob(job.id);
        expect(moved.stepPercent).toBe(50);
        expect(moved.percent).toBe(45);
      });
    } finally {
      release.open();
      await mediaQueue.idle();
    }

    const done = await getJob(job.id);
    expect(done.status).toBe("done");
    expect(done.stepIndex).toBe(2);
    expect(done.percent).toBe(100);
  });

  it("coalesces progress inside the interval into one trailing write", async () => {
    const release = gate();
    registerJobHandler(
      "convert",
      async (_job, report) => {
        for (const fraction of [0.1, 0.2, 0.3, 0.4, 0.5]) {
          void report.progress(fraction);
        }
        await release.opened;
      },
      { label: "Converting" }
    );

    await watchingEvents(async (events) => {
      const job = await enqueueJob({ projectId, kind: "convert" });
      const written = () =>
        events
          .filter((event) => event.id === job.id && event.status === "running")
          .filter((event) => event.percent > 0)
          .map((event) => event.percent);

      try {
        await waitFor(() => expect(written()).toEqual([10, 50]));
        await Bun.sleep(400);
        expect(written()).toEqual([10, 50]);
      } finally {
        release.open();
        await mediaQueue.idle();
      }
    });
  });

  it("drops a held write once the handler has returned", async () => {
    registerJobHandler(
      "convert",
      async (_job, report) => {
        await report.progress(0.2);
        await report.progress(0.6);
      },
      { label: "Converting" }
    );

    await watchingEvents(async (events) => {
      const job = await enqueueJob({ projectId, kind: "convert" });
      await mediaQueue.idle();
      await Bun.sleep(400);

      expect(
        events
          .filter((event) => event.id === job.id)
          .map((event) => [event.status, event.percent])
      ).toEqual([
        ["queued", 0],
        ["running", 0],
        ["running", 20],
        ["done", 100],
      ]);
      expect((await getJob(job.id)).percent).toBe(100);
    });
  });

  it("maps a child reporter's whole ladder into the current step", async () => {
    const release = gate();
    registerJobHandler(
      "convert",
      async (_job, report) => {
        const child = report.child([
          { key: "x", label: "Inner first", weight: 1 },
          { key: "y", label: "Inner second", weight: 1 },
        ]);
        await child.step("y");
        await child.progress(1);
        await release.opened;
      },
      {
        label: "Converting",
        steps: [{ key: "work", label: "Working", weight: 1 }],
      }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    try {
      await waitFor(async () => {
        const running = await getJob(job.id);
        expect(running.status).toBe("running");
        expect(running.stepIndex).toBe(0);
        expect(running.percent).toBe(100);
      });
    } finally {
      release.open();
      await mediaQueue.idle();
    }
  });

  it("refuses a ladder with no weight to measure by", () => {
    expect(() =>
      registerJobHandler("convert", async () => {}, {
        label: "Converting",
        steps: [{ key: "a", label: "A", weight: 0 }],
      })
    ).toThrow("no weight");
  });
});

describe("queue positions", () => {
  it("numbers waiting jobs and moves them up as the queue starts one", async () => {
    const gates = new Map<number, ReturnType<typeof gate>>();
    const gateOf = (id: number) => {
      if (!gates.has(id)) gates.set(id, gate());
      return gates.get(id)!;
    };
    registerJobHandler("convert", (job) => gateOf(job.id).opened, {
      label: "Converting",
    });

    const running: Job[] = [];
    for (let slot = 0; slot < mediaQueue.concurrency; slot++) {
      running.push(await enqueueJob({ projectId, kind: "convert" }));
    }
    const waiting: Job[] = [];
    for (let place = 0; place < 3; place++) {
      waiting.push(await enqueueJob({ projectId, kind: "convert" }));
    }
    const read = () => Promise.all(waiting.map((job) => getJob(job.id)));

    try {
      await waitFor(async () => {
        expect((await read()).map((job) => job.queuePosition)).toEqual([
          1, 2, 3,
        ]);
      });
      expect(
        (await Promise.all(running.map((job) => getJob(job.id)))).map(
          (job) => job.queuePosition
        )
      ).toEqual(running.map(() => null));

      gateOf(running[0]!.id).open();

      await waitFor(async () => {
        const [first, ...rest] = await read();
        expect(first!.status).toBe("running");
        expect(first!.queuePosition).toBeNull();
        expect(rest.map((job) => job.queuePosition)).toEqual([1, 2]);
      });
    } finally {
      for (const job of [...running, ...waiting]) gateOf(job.id).open();
      await mediaQueue.idle();
    }
  });
});

describe("cancel", () => {
  /** Handlers that wait on a gate per job, and the ids they started. */
  function gatedConvert() {
    const gates = new Map<number, ReturnType<typeof gate>>();
    const started: number[] = [];
    const gateOf = (id: number) => {
      if (!gates.has(id)) gates.set(id, gate());
      return gates.get(id)!;
    };
    registerJobHandler(
      "convert",
      async (job) => {
        started.push(job.id);
        await gateOf(job.id).opened;
      },
      { label: "Converting" }
    );
    return { gateOf, started };
  }

  it("takes a queued job off the queue and moves the rest up", async () => {
    const { gateOf, started } = gatedConvert();
    const running: Job[] = [];
    for (let slot = 0; slot < mediaQueue.concurrency; slot++) {
      running.push(await enqueueJob({ projectId, kind: "convert" }));
    }
    const doomed = await enqueueJob({ projectId, kind: "convert" });
    const behind = await enqueueJob({ projectId, kind: "convert" });

    try {
      await waitFor(async () =>
        expect((await getJob(behind.id)).queuePosition).toBe(2)
      );

      const cancelled = await cancelJob(doomed.id);
      expect(cancelled).toMatchObject({
        status: "cancelled",
        queuePosition: null,
        attempts: 0,
        label: "Converting",
      });
      expect(cancelled?.finishedAt).not.toBeNull();
      expect(mediaQueue.position(`job:${doomed.id}`)).toBeNull();
      expect((await getJob(behind.id)).queuePosition).toBe(1);
    } finally {
      for (const job of [...running, doomed, behind]) gateOf(job.id).open();
      await mediaQueue.idle();
    }

    expect(started).not.toContain(doomed.id);
    expect((await getJob(doomed.id)).status).toBe("cancelled");
    expect((await getJob(behind.id)).status).toBe("done");
  });

  it("aborts a running job's signal and ends it cancelled without a retry", async () => {
    let calls = 0;
    let aborted = false;
    registerJobHandler(
      "convert",
      async (_job, report) => {
        calls++;
        await new Promise((_, reject) =>
          report.signal.addEventListener("abort", () => {
            aborted = true;
            reject(report.signal.reason);
          })
        );
      },
      { label: "Converting", maxAttempts: 3 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await waitFor(async () =>
      expect((await getJob(job.id)).status).toBe("running")
    );

    const stopping = await cancelJob(job.id);
    expect(stopping).toMatchObject({
      status: "running",
      cancelRequested: true,
    });

    await waitFor(async () =>
      expect((await getJob(job.id)).status).toBe("cancelled")
    );
    await Bun.sleep(50);
    await mediaQueue.idle();

    const cancelled = await getJob(job.id);
    expect(aborted).toBe(true);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.attempts).toBe(0);
    expect(cancelled.finishedAt).not.toBeNull();
    expect(calls).toBe(1);
  });

  it("ends cancelled when a handler throws anything once a cancel was asked for", async () => {
    let calls = 0;
    registerJobHandler(
      "convert",
      async (_job, report) => {
        calls++;
        await new Promise((resolve) =>
          report.signal.addEventListener("abort", resolve)
        );
        throw new Error("stopped reading the file");
      },
      { label: "Converting", maxAttempts: 3 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await waitFor(async () =>
      expect((await getJob(job.id)).status).toBe("running")
    );
    await cancelJob(job.id);

    await waitFor(async () =>
      expect((await getJob(job.id)).status).toBe("cancelled")
    );
    await Bun.sleep(50);
    await mediaQueue.idle();
    expect((await getJob(job.id)).attempts).toBe(0);
    expect(calls).toBe(1);
  });

  it("stops a job waiting out a retry delay from running again", async () => {
    stubEnv("JOB_RETRY_DELAY_MS", "400");
    let calls = 0;
    registerJobHandler(
      "convert",
      async () => {
        calls++;
        throw new Error("first attempt fails");
      },
      { label: "Converting", maxAttempts: 2 }
    );

    try {
      const job = await enqueueJob({ projectId, kind: "convert" });
      await waitFor(async () => {
        const waiting = await getJob(job.id);
        expect(waiting.status).toBe("queued");
        expect(waiting.attempts).toBe(1);
      });

      expect(await cancelJob(job.id)).toMatchObject({ status: "cancelled" });

      await Bun.sleep(600);
      await mediaQueue.idle();
      expect(calls).toBe(1);
      expect((await getJob(job.id)).status).toBe("cancelled");
    } finally {
      unstubAllEnvs();
    }
  });

  it("answers undefined for a job that has already finished", async () => {
    const job = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();

    expect(await cancelJob(job.id)).toBeUndefined();
    expect((await getJob(job.id)).status).toBe("done");
  });
});

describe("overallPercent", () => {
  const ladder = [
    { key: "a", label: "A", weight: 1 },
    { key: "b", label: "B", weight: 3 },
  ];

  it("adds the finished steps' weight to the current step's share", () => {
    expect(overallPercent(ladder, 0, 0)).toBe(0);
    expect(overallPercent(ladder, 0, 1)).toBe(25);
    expect(overallPercent(ladder, 1, 0.5)).toBe(62.5);
    expect(overallPercent(ladder, 1, 1)).toBe(100);
  });

  it("reads zero for a ladder with nothing to weigh", () => {
    expect(overallPercent([], 0, 0.5)).toBe(0);
    expect(overallPercent([{ key: "a", label: "A", weight: 0 }], 0, 1)).toBe(0);
  });

  it("clamps a fraction outside 0..1", () => {
    expect(overallPercent(ladder, 1, 1.5)).toBe(100);
    expect(overallPercent(ladder, 1, -1)).toBe(25);
  });
});

describe("retries", () => {
  it("retries a handler that fails, and completes on the third attempt", async () => {
    let calls = 0;
    registerJobHandler(
      "convert",
      async () => {
        calls++;
        if (calls < 3) throw new Error(`boom ${calls}`);
      },
      { label: "Converting", maxAttempts: 3 }
    );

    // `JOB_RETRY_DELAY_MS` (set at the top of this file) shrinks the real
    // 5s/10s retry delay to milliseconds, so waiting for it to fire twice is
    // still fast — `mediaQueue.idle()` alone would resolve between attempts,
    // while the retry's `setTimeout` is still pending.
    const job = await enqueueJob({ projectId, kind: "convert" });
    await waitFor(() => expect(calls).toBe(3));
    await mediaQueue.idle();

    const done = await getJob(job.id);
    expect(done.status).toBe("done");
    expect(done.attempts).toBe(2);
  });

  it("starts a retried attempt's progress over", async () => {
    let calls = 0;
    registerJobHandler(
      "convert",
      async (_job, report) => {
        calls++;
        await report.step("b");
        if (calls === 1) throw new Error("first attempt fails");
      },
      { label: "Converting", maxAttempts: 2, steps: LADDER }
    );

    await watchingEvents(async (events) => {
      const job = await enqueueJob({ projectId, kind: "convert" });
      await waitFor(() => expect(calls).toBe(2));
      await mediaQueue.idle();

      const ofJob = events.filter((event) => event.id === job.id);
      expect(ofJob.find((event) => event.stepIndex === 1)).toMatchObject({
        attempts: 0,
        percent: 20,
      });
      expect(
        ofJob.find((event) => event.status === "queued" && event.attempts === 1)
      ).toMatchObject({
        status: "queued",
        attempts: 1,
        stepIndex: null,
        stepPercent: null,
        percent: 0,
        queuePosition: null,
      });
    });
  });

  it("fails immediately when the kind allows no retry", async () => {
    registerJobHandler(
      "convert",
      async () => {
        throw new Error("always fails");
      },
      { label: "Converting", maxAttempts: 1 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await mediaQueue.idle();

    const failed = await getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.error).toBe("always fails");
  });

  it("fails a MediaLimitError immediately even when the kind allows several retries", async () => {
    registerJobHandler(
      "convert",
      async () => {
        throw new MediaLimitError(
          "input declares 25000s, over the 21600s limit",
          "media_too_long"
        );
      },
      { label: "Converting", maxAttempts: 3 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await mediaQueue.idle();

    const failed = await getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.error).toBe(
      "media_too_long: input declares 25000s, over the 21600s limit"
    );
  });

  it("retries and fails with the error message on MediaTimeoutError instead of cancelling", async () => {
    let calls = 0;
    registerJobHandler(
      "convert",
      async () => {
        calls++;
        throw new MediaTimeoutError(
          "converting x.wav exceeded 60000ms deadline"
        );
      },
      { label: "Converting", maxAttempts: 2 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await waitFor(() => expect(calls).toBe(2));
    await mediaQueue.idle();

    const failed = await getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(2);
    expect(failed.error).toBe("converting x.wav exceeded 60000ms deadline");
  });

  it("resets a failed job to queued and runs it again", async () => {
    let calls = 0;
    registerJobHandler(
      "convert",
      async () => {
        calls++;
        if (calls === 1) throw new Error("first attempt fails");
      },
      { label: "Converting", maxAttempts: 1 }
    );

    const job = await enqueueJob({ projectId, kind: "convert" });
    await mediaQueue.idle();
    expect((await getJob(job.id)).status).toBe("failed");

    const retried = await retryJob(job.id);
    expect(retried?.status).toBe("queued");
    expect(retried?.attempts).toBe(0);

    await mediaQueue.idle();
    expect((await getJob(job.id)).status).toBe("done");
    expect(calls).toBe(2);
  });

  it("clears a failed job's progress when it is retried", async () => {
    registerJobHandler("convert", async () => {}, { label: "Converting" });
    const [failed] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "convert",
        status: "failed",
        error: "boom",
        attempts: 1,
        finishedAt: new Date(),
        stepIndex: 2,
        stepPercent: 40,
        percent: 80,
        cancelRequested: true,
      })
      .returning();

    const retried = await retryJob(failed!.id);
    expect(retried).toMatchObject({
      status: "queued",
      attempts: 0,
      error: null,
      finishedAt: null,
      stepIndex: null,
      stepPercent: null,
      percent: 0,
      cancelRequested: false,
    });

    await mediaQueue.idle();
  });

  it("refuses to retry a job that is not failed", async () => {
    registerJobHandler("convert", async () => {}, {
      label: "Converting",
      maxAttempts: 1,
    });

    const job = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();
    expect((await getJob(job.id)).status).toBe("done");

    expect(await retryJob(job.id)).toBeUndefined();
  });
});

describe("getProjectJobs", () => {
  it("lists a project's jobs newest first and narrows by status", async () => {
    const failing = await enqueueJob({ projectId, kind: "image_variants" });
    const backfill = await enqueueAudioBackfill(projectId);
    await mediaQueue.idle();

    expect((await getProjectJobs(projectId)).map((job) => job.id)).toEqual([
      backfill.id,
      failing.id,
    ]);

    const done = await getProjectJobs(projectId, { statuses: ["done"] });
    expect(done.map((job) => job.id)).toEqual([backfill.id]);

    const failed = await getProjectJobs(projectId, {
      statuses: ["failed"],
    });
    expect(failed.map((job) => job.id)).toEqual([failing.id]);
  });

  it("returns at most MAX_PROJECT_JOBS, newest first", async () => {
    const overflow = 5;
    const written = await db
      .insert(jobs)
      .values(
        Array.from({ length: MAX_PROJECT_JOBS + overflow }, () => ({
          projectId,
          kind: "image_variants" as const,
        }))
      )
      .returning({ id: jobs.id });

    const newest = written
      .map((row) => row.id)
      .sort((a, b) => b - a)
      .slice(0, MAX_PROJECT_JOBS);

    const listed = await getProjectJobs(projectId);
    expect(listed).toHaveLength(MAX_PROJECT_JOBS);
    expect(listed.map((job) => job.id)).toEqual(newest);
  });
});

describe("job names", () => {
  it("names every job it reads by its kind and its subject", async () => {
    const [analysis] = await db
      .insert(jobs)
      .values({
        projectId,
        kind: "audio_analysis",
        subjectId: trackAudioIds[1]!,
      })
      .returning();
    const held = gate();
    media.decodeInto.mockImplementation(async () => {
      await held.opened;
      return 0;
    });
    const backfill = await enqueueAudioBackfill(projectId);

    expect(await getJob(analysis!.id)).toMatchObject({
      label: "Analysing audio",
      subjectLabel: "job-2.wav",
    });
    // A backfill's file count is only known once it has run.
    expect(await getJob(backfill.id)).toMatchObject({
      label: "Analysing project audio",
      subjectLabel: null,
    });

    held.open();
    await mediaQueue.idle();

    const listed = await getProjectJobs(projectId);
    expect(
      listed.map(({ id, label, subjectLabel }) => ({ id, label, subjectLabel }))
    ).toEqual([
      {
        id: backfill.id,
        label: "Analysing project audio",
        subjectLabel: `${AUDIO_COUNT} files`,
      },
      {
        id: analysis!.id,
        label: "Analysing audio",
        subjectLabel: "job-2.wav",
      },
    ]);
  });
});
