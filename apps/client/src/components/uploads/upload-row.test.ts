import { describe, expect, it } from "bun:test";
import type { Job } from "@workspace/api/api";
import {
  uploadRowPhase,
  uploadRowShouldClose,
  uploadRowText,
} from "@/components/uploads/upload-row";

const job = (overrides: Partial<Job> = {}) =>
  ({
    id: 1,
    kind: "audio_analysis",
    status: "running",
    percent: 40,
    steps: [],
    stepIndex: null,
    stepPercent: null,
    queuePosition: null,
    label: "Analysing audio",
    subjectLabel: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as Job;

describe("uploadRowPhase", () => {
  it("stays uploading while the byte transfer is in flight, whatever the caller queued", () => {
    expect(
      uploadRowPhase({
        status: "uploading",
        jobId: 7,
        job: undefined,
        hasTrackedJob: false,
      })
    ).toBe("uploading");
  });

  it("fails outright for a byte transfer error", () => {
    expect(
      uploadRowPhase({
        status: "error",
        jobId: undefined,
        job: undefined,
        hasTrackedJob: false,
      })
    ).toBe("failed");
  });

  it("finishes once the transfer completes with no job to follow", () => {
    expect(
      uploadRowPhase({
        status: "completed",
        jobId: undefined,
        job: undefined,
        hasTrackedJob: false,
      })
    ).toBe("done");
  });

  it("follows a queued job that has not appeared on the map yet", () => {
    expect(
      uploadRowPhase({
        status: "completed",
        jobId: 7,
        job: undefined,
        hasTrackedJob: false,
      })
    ).toBe("following");
  });

  it("keeps following while the job is live", () => {
    expect(
      uploadRowPhase({
        status: "completed",
        jobId: 7,
        job: job({ status: "running" }),
        hasTrackedJob: true,
      })
    ).toBe("following");
  });

  it("finishes once a tracked job has lingered out of the map", () => {
    expect(
      uploadRowPhase({
        status: "completed",
        jobId: 7,
        job: undefined,
        hasTrackedJob: true,
      })
    ).toBe("done");
  });

  it("fails when the job itself fails, and does not wait for it to linger out", () => {
    expect(
      uploadRowPhase({
        status: "completed",
        jobId: 7,
        job: job({ status: "failed" }),
        hasTrackedJob: true,
      })
    ).toBe("failed");
  });
});

describe("uploadRowShouldClose", () => {
  it("closes once a followed job's row has lingered out", () => {
    expect(
      uploadRowShouldClose({ phase: "done", jobId: 7, hasTrackedJob: true })
    ).toBe(true);
  });

  it("stays open for a plain upload with nothing to follow", () => {
    expect(
      uploadRowShouldClose({
        phase: "done",
        jobId: undefined,
        hasTrackedJob: false,
      })
    ).toBe(false);
  });

  it("stays open while still following, even once a done job's linger is ticking", () => {
    expect(
      uploadRowShouldClose({
        phase: "following",
        jobId: 7,
        hasTrackedJob: true,
      })
    ).toBe(false);
  });

  it("never closes a failed row", () => {
    expect(
      uploadRowShouldClose({ phase: "failed", jobId: 7, hasTrackedJob: true })
    ).toBe(false);
  });
});

describe("uploadRowText", () => {
  it("shows the literal UPLOADING caption and the byte fraction while uploading", () => {
    const text = uploadRowText({
      phase: "uploading",
      progress: 0.42,
      job: undefined,
      now: 0,
    });
    expect(text.caption).toBe("UPLOADING");
    expect(text.percent).toBe(42);
    expect(text.stepLine).toBeNull();
  });

  it("shows a placeholder while following a job that has not appeared yet", () => {
    const text = uploadRowText({
      phase: "following",
      progress: 1,
      job: undefined,
      now: 0,
    });
    expect(text.caption).toBe("Processing…");
    expect(text.percent).toBeNull();
  });

  it("switches the caption to the job's current step label once it is live", () => {
    const text = uploadRowText({
      phase: "following",
      progress: 1,
      job: job({
        steps: [
          { key: "measure", label: "Measuring loudness", weight: 1 },
          { key: "store", label: "Saving", weight: 1 },
        ],
        stepIndex: 0,
        percent: 30,
      }),
      now: 0,
    });
    expect(text.caption).toBe("Measuring loudness");
    expect(text.stepLine).toBe("Step 1 of 2");
    expect(text.percent).toBe(30);
  });

  it("shows the job's error once it fails", () => {
    const text = uploadRowText({
      phase: "failed",
      progress: 1,
      job: job({ status: "failed", error: "Couldn't read the file." }),
      now: 0,
    });
    expect(text.caption).toBe("Couldn't read the file.");
  });

  it("falls back to a generic upload failure with no job behind it", () => {
    const text = uploadRowText({
      phase: "failed",
      progress: 0,
      job: undefined,
      now: 0,
    });
    expect(text.caption).toBe("Upload failed");
  });

  it("shows nothing once the row is done, its own silent confirmation", () => {
    const text = uploadRowText({
      phase: "done",
      progress: 1,
      job: undefined,
      now: 0,
    });
    expect(text.caption).toBeNull();
    expect(text.percent).toBeNull();
  });
});
