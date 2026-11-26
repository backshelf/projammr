import { describe, expect, it, mock } from "bun:test";
import type { Job, JobKind, JobStatus } from "@workspace/api/api";

import {
  applyEvent,
  createDrainWatch,
  createFinishWatch,
  DRAIN_TICK_MS,
  elapsedLabel,
  fallbackDelay,
  FALLBACK_POLL_MS,
  IDLE_POLL_MS,
  lingerUntil,
  orderJobs,
  trayIndicator,
} from "./jobs-poll";

const job = (
  id: number,
  overrides: Partial<Job> & { status?: JobStatus; kind?: JobKind } = {}
) =>
  ({
    id,
    kind: "convert",
    status: "running",
    queuePosition: null,
    finishedAt: null,
    startedAt: null,
    ...overrides,
  }) as Job;

describe("applyEvent", () => {
  it("replaces the map wholesale on a snapshot", () => {
    const before = new Map([[9, job(9)]]);
    const after = applyEvent(before, { type: "snapshot", jobs: [job(1)] });

    expect([...after.keys()]).toEqual([1]);
  });

  it("upserts one row on a job event, leaving the rest of the map alone", () => {
    const before = new Map([
      [1, job(1, { status: "queued" })],
      [2, job(2)],
    ]);
    const after = applyEvent(before, {
      type: "job",
      job: job(1, { status: "running" }),
    });

    expect(after.get(1)?.status).toBe("running");
    expect(after.get(2)?.status).toBe("running");
    expect(after).not.toBe(before);
  });
});

describe("lingerUntil", () => {
  it("is null for a row still moving", () => {
    expect(lingerUntil(job(1, { status: "running" }))).toBeNull();
    expect(lingerUntil(job(1, { status: "queued" }))).toBeNull();
  });

  it("is null for a failed row, which stays until cleared", () => {
    expect(lingerUntil(job(1, { status: "failed" }))).toBeNull();
  });

  it("is four seconds past `finishedAt` for a done or cancelled row", () => {
    const finishedAt = "2026-09-13T10:00:00.000Z";
    const at = new Date(finishedAt).getTime();

    expect(lingerUntil(job(1, { status: "done", finishedAt }))).toBe(at + 4000);
    expect(lingerUntil(job(1, { status: "cancelled", finishedAt }))).toBe(
      at + 4000
    );
  });
});

describe("fallbackDelay", () => {
  it("reads quickly while something is queued or running", () => {
    expect(fallbackDelay({ visible: true, active: true })).toBe(
      FALLBACK_POLL_MS
    );
  });

  it("slows to once a minute when idle", () => {
    expect(fallbackDelay({ visible: true, active: false })).toBe(IDLE_POLL_MS);
  });

  it("stops while the tab is hidden, busy or not", () => {
    expect(fallbackDelay({ visible: false, active: true })).toBeNull();
    expect(fallbackDelay({ visible: false, active: false })).toBeNull();
  });
});

describe("orderJobs", () => {
  it("orders running first, then queued by position, then lingering, then failed", () => {
    const running = job(1, { status: "running" });
    const queuedFirst = job(2, { status: "queued", queuePosition: 1 });
    const queuedSecond = job(3, { status: "queued", queuePosition: 2 });
    const lingeringDone = job(4, { status: "done" });
    const lingeringCancelled = job(5, { status: "cancelled" });
    const failed = job(6, { status: "failed" });

    const ordered = orderJobs([
      failed,
      queuedSecond,
      lingeringDone,
      running,
      lingeringCancelled,
      queuedFirst,
    ]);

    expect(ordered.map((j) => j.id)).toEqual([1, 2, 3, 5, 4, 6]);
  });
});

describe("createDrainWatch", () => {
  const ANALYSIS: ReadonlySet<JobKind> = new Set([
    "audio_analysis",
    "audio_backfill",
  ]);

  it("does not fire before its first read", () => {
    const onDrain = mock();
    createDrainWatch(ANALYSIS, onDrain);

    expect(onDrain).not.toHaveBeenCalled();
  });

  it("fires once when a watched kind goes from present to absent", () => {
    const onDrain = mock();
    const observe = createDrainWatch(ANALYSIS, onDrain);

    observe([job(1, { kind: "audio_analysis" })]);
    observe([job(1, { kind: "audio_analysis" })]);
    expect(onDrain).not.toHaveBeenCalled();

    observe([]);
    observe([]);
    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it("counts a first read that finds nothing, so a short job is not missed", () => {
    const onDrain = mock();
    const observe = createDrainWatch(ANALYSIS, onDrain);

    observe([]);
    observe([]);
    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it("ignores kinds it is not watching", () => {
    const onDrain = mock();
    const observe = createDrainWatch(ANALYSIS, onDrain);

    observe([job(1, { kind: "audio_analysis" }), job(2, { kind: "convert" })]);
    observe([job(2, { kind: "convert" })]);
    expect(onDrain).toHaveBeenCalledTimes(1);

    observe([]);
    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it("only counts a kind that is actually running or queued", () => {
    const onDrain = mock();
    const observe = createDrainWatch(ANALYSIS, onDrain);

    // A lingering `done` row of a watched kind is not "present" any more.
    observe([job(1, { kind: "audio_analysis", status: "done" })]);
    expect(onDrain).toHaveBeenCalledTimes(1);
  });
});

describe("createFinishWatch", () => {
  const ANALYSIS: ReadonlySet<JobKind> = new Set([
    "audio_analysis",
    "audio_backfill",
  ]);

  it("does not fire on its first read, whatever it finds", () => {
    const onFinish = mock();
    const observe = createFinishWatch(ANALYSIS, onFinish);

    observe([]);
    observe([]);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("fires when one watched job finishes while another is still running", () => {
    const onFinish = mock();
    const observe = createFinishWatch(ANALYSIS, onFinish);

    observe([
      job(1, { kind: "audio_backfill" }),
      job(2, { kind: "audio_analysis", status: "queued" }),
    ]);
    observe([
      job(1, { kind: "audio_backfill" }),
      job(2, { kind: "audio_analysis", status: "done" }),
    ]);
    expect(onFinish).toHaveBeenCalledTimes(1);

    observe([job(1, { kind: "audio_backfill" })]);
    expect(onFinish).toHaveBeenCalledTimes(1);

    observe([]);
    expect(onFinish).toHaveBeenCalledTimes(2);
  });

  it("fires once for an update in which several jobs finished", () => {
    const onFinish = mock();
    const observe = createFinishWatch(ANALYSIS, onFinish);

    observe([
      job(1, { kind: "audio_analysis" }),
      job(2, { kind: "audio_analysis" }),
    ]);
    observe([]);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a job only moves from queued to running, or a new one arrives", () => {
    const onFinish = mock();
    const observe = createFinishWatch(ANALYSIS, onFinish);

    observe([job(1, { kind: "audio_analysis", status: "queued" })]);
    observe([job(1, { kind: "audio_analysis", status: "running" })]);
    observe([
      job(1, { kind: "audio_analysis", status: "running" }),
      job(2, { kind: "audio_analysis", status: "queued" }),
    ]);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("ignores kinds it is not watching", () => {
    const onFinish = mock();
    const observe = createFinishWatch(ANALYSIS, onFinish);

    observe([job(1, { kind: "convert" })]);
    observe([]);
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("trayIndicator", () => {
  it("spins while anything runs, even with failures waiting", () => {
    expect(
      trayIndicator({
        jobs: [job(1, { status: "running" }), job(2, { status: "failed" })],
        now: 0,
      })
    ).toBe("running");
  });

  it("never treats a cancelled row as running", () => {
    expect(
      trayIndicator({ jobs: [job(1, { status: "cancelled" })], now: 0 })
    ).toBe("hidden");
  });

  it("ticks for the second right after a done row finishes, then moves on", () => {
    const finishedAt = "2026-09-13T10:00:00.000Z";
    const at = new Date(finishedAt).getTime();
    const doneRow = [job(1, { status: "done", finishedAt })];

    expect(trayIndicator({ jobs: doneRow, now: at })).toBe("drained");
    expect(trayIndicator({ jobs: doneRow, now: at + DRAIN_TICK_MS - 1 })).toBe(
      "drained"
    );
    expect(trayIndicator({ jobs: doneRow, now: at + DRAIN_TICK_MS })).toBe(
      "hidden"
    );
  });

  it("warns about failures once nothing is running or newly drained", () => {
    expect(
      trayIndicator({ jobs: [job(1, { status: "failed" })], now: 0 })
    ).toBe("failed");
  });

  it("stays hidden for work that is only queued", () => {
    expect(
      trayIndicator({ jobs: [job(1, { status: "queued" })], now: 0 })
    ).toBe("hidden");
  });
});

describe("elapsedLabel", () => {
  const start = new Date("2026-09-13T10:00:00Z");

  it("reads seconds under a minute and whole minutes after", () => {
    expect(elapsedLabel(start.toISOString(), start.getTime() + 42_000)).toBe(
      "42s"
    );
    expect(elapsedLabel(start, start.getTime() + 185_000)).toBe("3m");
  });
});
