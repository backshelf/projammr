import { describe, expect, it } from "bun:test";
import type { Job } from "@workspace/api/api";

import { describeJobRow, groupFailures, jobsAnnouncement } from "./job-row";

const job = (overrides: Partial<Job> = {}) =>
  ({
    id: 1,
    kind: "audio_analysis",
    status: "running",
    percent: 0,
    steps: [],
    stepIndex: null,
    stepPercent: null,
    queuePosition: null,
    label: "Analysing audio",
    subjectLabel: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as Job;

const THREE_STEPS = [
  { key: "decode", label: "Decoding and measuring", weight: 80 },
  { key: "analyse", label: "Detecting tempo, key and sections", weight: 15 },
  { key: "store", label: "Saving", weight: 5 },
];

describe("describeJobRow", () => {
  it("names the subject in the eyebrow when the server sent one", () => {
    const row = describeJobRow(job({ subjectLabel: "v3 mix.wav" }), 0);

    expect(row.eyebrow).toBe("Analysing audio · v3 mix.wav");
  });

  it("drops the subject from the eyebrow when the server sent none", () => {
    const row = describeJobRow(job({ subjectLabel: null }), 0);

    expect(row.eyebrow).toBe("Analysing audio");
  });

  it("titles the row with the current step and reads its place in a three-step ladder", () => {
    const row = describeJobRow(job({ steps: THREE_STEPS, stepIndex: 1 }), 0);

    expect(row.title).toBe("Detecting tempo, key and sections");
    expect(row.stepLine).toBe("Step 2 of 3");
  });

  it("hides the step line for a one-step ladder", () => {
    const row = describeJobRow(
      job({
        steps: [{ key: "run", label: "Converting", weight: 1 }],
        stepIndex: 0,
      }),
      0
    );

    expect(row.stepLine).toBeNull();
  });

  it("falls back to the kind's label before a run has claimed the row", () => {
    const row = describeJobRow(
      job({ status: "queued", steps: [], stepIndex: null }),
      0
    );

    expect(row.title).toBe("Analysing audio");
  });

  it("reads a queued row's place in the server's process-wide queue", () => {
    const row = describeJobRow(job({ status: "queued", queuePosition: 3 }), 0);

    expect(row.queueLine).toBe("Queued · #3");
    expect(row.statusLine).toBeNull();
  });

  it("reads a running row's elapsed time from startedAt and now", () => {
    const startedAt = "2026-09-13T10:00:00.000Z";
    const row = describeJobRow(
      job({ startedAt }),
      new Date(startedAt).getTime() + 42_000
    );

    expect(row.statusLine).toBe("42s");
  });

  it("reads Done and Cancelled for finished rows", () => {
    expect(describeJobRow(job({ status: "done" }), 0).statusLine).toBe("Done");
    expect(describeJobRow(job({ status: "cancelled" }), 0).statusLine).toBe(
      "Cancelled"
    );
  });

  it("shows no status line for a failed row", () => {
    expect(describeJobRow(job({ status: "failed" }), 0).statusLine).toBeNull();
  });
});

describe("groupFailures", () => {
  const failed = (id: number, overrides: Partial<Job> = {}) =>
    job({
      id,
      status: "failed",
      subjectLabel: "nightdrive.mp3",
      stepIndex: 0,
      error: "ffmpeg could not read nightdrive.mp3",
      ...overrides,
    });

  it("collapses the same failure into one group led by its newest job", () => {
    const groups = groupFailures([failed(9), failed(8), failed(7)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.job.id).toBe(9);
    expect(groups[0]!.ids).toEqual([9, 8, 7]);
  });

  it("keeps failures apart when the subject, the step or the error differs", () => {
    const groups = groupFailures([
      failed(4),
      failed(3, { subjectLabel: "v2.wav" }),
      failed(2, { stepIndex: 1 }),
      failed(1, { error: "Out of memory" }),
    ]);

    expect(groups.map((group) => group.ids)).toEqual([[4], [3], [2], [1]]);
  });
});

describe("jobsAnnouncement", () => {
  const map = (...jobs: Job[]) => new Map(jobs.map((j) => [j.id, j]));

  it("names a job that was running and has failed", () => {
    const said = jobsAnnouncement(
      map(job({ subjectLabel: "v3 mix.wav" })),
      map(job({ subjectLabel: "v3 mix.wav", status: "failed" }))
    );

    expect(said).toBe("Analysing audio · v3 mix.wav failed");
  });

  it("counts several jobs that failed in one update", () => {
    const said = jobsAnnouncement(
      map(job({ id: 1 }), job({ id: 2, status: "queued" })),
      map(job({ id: 1, status: "failed" }), job({ id: 2, status: "failed" }))
    );

    expect(said).toBe("2 background jobs failed");
  });

  it("says the queue finished once the last active job is done", () => {
    const said = jobsAnnouncement(
      map(job({ id: 1 })),
      map(job({ id: 1, status: "done" }))
    );

    expect(said).toBe("Background jobs finished");
  });

  it("stays quiet while other jobs are still active", () => {
    const said = jobsAnnouncement(
      map(job({ id: 1 }), job({ id: 2, status: "queued" })),
      map(job({ id: 1, status: "done" }), job({ id: 2 }))
    );

    expect(said).toBeNull();
  });

  it("stays quiet for jobs it never saw active, as on a project switch", () => {
    const said = jobsAnnouncement(
      map(),
      map(job({ id: 7, status: "failed" }), job({ id: 8, status: "done" }))
    );

    expect(said).toBeNull();
  });
});
