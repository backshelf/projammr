import { describe, expect, it } from "bun:test";
import type { Job } from "@workspace/api/api";
import {
  convertOutcome,
  isConvertRequestRunning,
  shouldSettleConvertRequest,
} from "@/components/uploads/convert-outcome";

const job = (overrides: Partial<Job> = {}) =>
  ({
    id: 1,
    kind: "convert",
    status: "running",
    percent: 0,
    steps: [],
    stepIndex: null,
    stepPercent: null,
    queuePosition: null,
    label: "Converting",
    subjectLabel: null,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as Job;

describe("convertOutcome", () => {
  it("reads pending before the job has appeared on the map", () => {
    expect(convertOutcome(undefined)).toEqual({ kind: "pending" });
  });

  it("reads the percent from a queued or running row", () => {
    expect(convertOutcome(job({ status: "queued", percent: 0 }))).toEqual({
      kind: "running",
      percent: 0,
    });
    expect(convertOutcome(job({ status: "running", percent: 63.4 }))).toEqual({
      kind: "running",
      percent: 63,
    });
  });

  it("hands back the output once the job is done", () => {
    const result = { url: "converted.mp3", name: "converted.mp3" };
    expect(convertOutcome(job({ status: "done", result }))).toEqual({
      kind: "done",
      output: result,
    });
  });

  it("hands back an empty output rather than crashing on a done job with none", () => {
    expect(convertOutcome(job({ status: "done", result: null }))).toEqual({
      kind: "done",
      output: {},
    });
  });

  it("reads the job's own error once it fails", () => {
    expect(
      convertOutcome(job({ status: "failed", error: "ffmpeg exited 1" }))
    ).toEqual({ kind: "failed", message: "ffmpeg exited 1" });
  });

  it("falls back to a generic message for a failed job with no error text", () => {
    expect(convertOutcome(job({ status: "failed", error: null }))).toEqual({
      kind: "failed",
      message: "Conversion failed.",
    });
  });

  it("reads a cancelled job as failed, since there is nothing left to download", () => {
    expect(convertOutcome(job({ status: "cancelled" }))).toEqual({
      kind: "failed",
      message: "The conversion was cancelled.",
    });
  });
});

describe("isConvertRequestRunning", () => {
  it("is running while the job itself is running", () => {
    expect(
      isConvertRequestRunning({ kind: "running", percent: 10 }, true)
    ).toBe(true);
  });

  it("is running for a job never tracked before, even before it appears", () => {
    expect(isConvertRequestRunning({ kind: "pending" }, false)).toBe(true);
  });

  it("is not running for a pending outcome on a job already tracked once", () => {
    // The server can hand back a job that already finished and lingered out
    // of the live map before this dialog ever saw it — a stale "not seen
    // yet" from `useTrackedJob`'s own resolve, not one still in flight.
    expect(isConvertRequestRunning({ kind: "pending" }, true)).toBe(false);
  });

  it("is not running once the job is done or failed", () => {
    expect(isConvertRequestRunning({ kind: "done", output: {} }, true)).toBe(
      false
    );
    expect(
      isConvertRequestRunning({ kind: "failed", message: "x" }, true)
    ).toBe(false);
  });

  it("is not running with no request in flight", () => {
    expect(isConvertRequestRunning(null, false)).toBe(false);
  });
});

describe("shouldSettleConvertRequest", () => {
  const request = { jobId: 1, requestId: 1 };

  it("does not settle a request still pending or running", () => {
    expect(shouldSettleConvertRequest(request, { kind: "pending" }, null)).toBe(
      false
    );
    expect(
      shouldSettleConvertRequest(
        request,
        { kind: "running", percent: 50 },
        null
      )
    ).toBe(false);
  });

  it("settles a request the very first time its outcome is done", () => {
    expect(
      shouldSettleConvertRequest(request, { kind: "done", output: {} }, null)
    ).toBe(true);
  });

  it("does not settle the same request twice", () => {
    // An unrelated jobs-map update (a snapshot, a reconnect) hands back a new
    // `Job` object for a job that already settled; that must not re-download
    // or re-toast.
    expect(
      shouldSettleConvertRequest(
        request,
        { kind: "done", output: {} },
        request.requestId
      )
    ).toBe(false);
  });

  it("settles a later request that reuses the same job id", () => {
    // A repeat conversion to the same format hands back the job that already
    // did it — already `done` from the moment this new request starts — so
    // the new request's own id, not the job's, is what must be unhandled.
    const secondRequest = { jobId: request.jobId, requestId: 2 };
    expect(
      shouldSettleConvertRequest(
        secondRequest,
        { kind: "done", output: {} },
        request.requestId
      )
    ).toBe(true);
  });
});
