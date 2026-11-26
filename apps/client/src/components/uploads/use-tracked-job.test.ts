import { describe, expect, it } from "bun:test";
import { partial } from "@workspace/test/fixture";
import type { Job } from "@workspace/api/api";
import { LINGER_MS } from "@/components/jobs/jobs-poll";
import {
  presentedTrackedJob,
  shouldFetchTrackedJob,
} from "@/components/uploads/use-tracked-job";

const job = partial<Job>({
  id: 7,
  kind: "audio_analysis",
  status: "running",
  percent: 0,
  steps: [],
  stepIndex: null,
  stepPercent: null,
  queuePosition: null,
  label: "Analysing audio",
  subjectLabel: null,
  error: null,
  startedAt: null,
  finishedAt: null,
});

describe("shouldFetchTrackedJob", () => {
  it("does not fetch before the map has done its first real read", () => {
    // A job just queued may simply not have reached the stream's first
    // frame yet; fetching here would race the stream for no reason.
    expect(
      shouldFetchTrackedJob({
        jobId: 7,
        job: undefined,
        hasTrackedJob: false,
        loaded: false,
      })
    ).toBe(false);
  });

  it("fetches a job the loaded map has never carried at all", () => {
    // A repeat request can hand back a job that already finished (and
    // lingered out) before this caller ever saw it live, and a job whose
    // whole life fit between two fallback polls never appears on the map at
    // all — both read as "never seen" here.
    expect(
      shouldFetchTrackedJob({
        jobId: 7,
        job: undefined,
        hasTrackedJob: false,
        loaded: true,
      })
    ).toBe(true);
  });

  it("does not fetch once the job is already live", () => {
    expect(
      shouldFetchTrackedJob({
        jobId: 7,
        job,
        hasTrackedJob: true,
        loaded: true,
      })
    ).toBe(false);
  });

  it("does not fetch a job already resolved, even once it lingers out of the live map", () => {
    expect(
      shouldFetchTrackedJob({
        jobId: 7,
        job: undefined,
        hasTrackedJob: true,
        loaded: true,
      })
    ).toBe(false);
  });

  it("does not fetch with nothing to follow", () => {
    expect(
      shouldFetchTrackedJob({
        jobId: undefined,
        job: undefined,
        hasTrackedJob: false,
        loaded: true,
      })
    ).toBe(false);
  });
});

describe("presentedTrackedJob", () => {
  const finishedAt = "2026-09-17T10:00:00.000Z";
  const finished = Date.parse(finishedAt);

  it("prefers the live row over a direct read", () => {
    const live = { ...job, status: "running", percent: 40 } as Job;
    const fetched = { ...job, status: "queued" } as Job;
    expect(
      presentedTrackedJob({ liveJob: live, fetchedJob: fetched, now: 0 })
    ).toBe(live);
  });

  it("shows a directly read finished job only for its linger", () => {
    const done = { ...job, status: "done", finishedAt } as Job;
    expect(
      presentedTrackedJob({
        liveJob: undefined,
        fetchedJob: done,
        now: finished + LINGER_MS - 1,
      })
    ).toBe(done);
    expect(
      presentedTrackedJob({
        liveJob: undefined,
        fetchedJob: done,
        now: finished + LINGER_MS,
      })
    ).toBeUndefined();
  });

  it("keeps a directly read failed job, as the tray keeps a failed row", () => {
    const failed = { ...job, status: "failed", finishedAt } as Job;
    expect(
      presentedTrackedJob({
        liveJob: undefined,
        fetchedJob: failed,
        now: finished + 60_000,
      })
    ).toBe(failed);
  });
});
