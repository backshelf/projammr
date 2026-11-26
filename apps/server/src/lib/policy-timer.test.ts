import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { startPolicyTimer } from "./policy-timer.js";

/** The audit interval in seconds rather than hours, so a test can wait it out. */
const auditSeconds = (policy: { limits: { auditIntervalHours: number } }) =>
  policy.limits.auditIntervalHours * 1000;

let stop: (() => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  restoreInstancePolicy();
  jest.useRealTimers();
});

describe("startPolicyTimer", () => {
  it("runs the task every interval the policy names", () => {
    const task = mock(() => {});
    stop = startPolicyTimer(task, { intervalMs: auditSeconds });

    jest.advanceTimersByTime(23_999);
    expect(task).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(24_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("re-arms once at the new interval when a refresh changes it", () => {
    const task = mock(() => {});
    stop = startPolicyTimer(task, { intervalMs: auditSeconds });

    jest.advanceTimersByTime(10_000);
    stubInstancePolicy({ limits: { auditIntervalHours: 6 } });

    // Six seconds from the refresh, not the fourteen the old timer had left.
    jest.advanceTimersByTime(6_000);
    expect(task).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(6_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("leaves the timer where it was when a refresh changes something else", () => {
    const task = mock(() => {});
    stop = startPolicyTimer(task, { intervalMs: auditSeconds });

    jest.advanceTimersByTime(20_000);
    stubInstancePolicy({ limits: { maxUploadMb: 64 } });

    jest.advanceTimersByTime(4_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs once at once and restarts the interval when the value it works to changes", () => {
    const task = mock(() => {});
    stop = startPolicyTimer(task, {
      intervalMs: () => 10_000,
      runAgainOn: (policy) => policy.jobs.activityRetentionDays,
    });

    jest.advanceTimersByTime(5_000);
    stubInstancePolicy({ jobs: { activityRetentionDays: 30 } });
    expect(task).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);
    expect(task).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5_000);
    expect(task).toHaveBeenCalledTimes(2);

    // The same value again is no change.
    stubInstancePolicy({ jobs: { activityRetentionDays: 30 } });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("waits out an interval longer than a timer can hold rather than looping", () => {
    const task = mock(() => {});
    const hours = (n: number) => n * 60 * 60 * 1000;
    stop = startPolicyTimer(task, { intervalMs: () => hours(720) });

    jest.advanceTimersByTime(1_000);
    expect(task).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(hours(720) - 1_000);
    expect(task).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(hours(720));
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("stops running and stops listening once stopped", () => {
    const task = mock(() => {});
    const stopTimer = startPolicyTimer(task, {
      intervalMs: auditSeconds,
      runAgainOn: (policy) => policy.jobs.activityRetentionDays,
    });

    stopTimer();
    stubInstancePolicy({ jobs: { activityRetentionDays: 30 } });
    jest.advanceTimersByTime(48_000);

    expect(task).toHaveBeenCalledTimes(0);
  });
});
