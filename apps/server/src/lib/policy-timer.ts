import {
  type InstancePolicy,
  instancePolicy,
  onInstancePolicyChange,
} from "./instance-policy.js";

export type PolicyTimerOptions = {
  /** How long between runs under a policy, in milliseconds. */
  intervalMs: (policy: InstancePolicy) => number;
  /**
   * A value the task works to — a retention window, say. A refresh that
   * changes it runs the task once at once and restarts the interval from
   * there, so a new value applies now rather than at the next tick.
   */
  runAgainOn?: (policy: InstancePolicy) => unknown;
};

/**
 * The longest delay a timer holds: past it the runtime fires after 1 ms
 * instead, which a 30-day audit interval would otherwise turn into a loop.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Runs `task` every `ms`, unreferenced. An interval past `MAX_TIMER_MS` is
 * waited out in capped steps towards its due time. Returns the stop.
 */
function every(task: () => void, ms: number): () => void {
  if (ms <= MAX_TIMER_MS) {
    const interval = setInterval(task, ms).unref();
    return () => clearInterval(interval);
  }
  let due = Date.now() + ms;
  let timeout: ReturnType<typeof setTimeout>;
  const wait = () => {
    timeout = setTimeout(
      tick,
      Math.min(MAX_TIMER_MS, Math.max(0, due - Date.now()))
    ).unref();
  };
  const tick = () => {
    if (Date.now() >= due) {
      due = Date.now() + ms;
      task();
    }
    wait();
  };
  wait();
  return () => clearTimeout(timeout);
}

/**
 * Runs `task` every `intervalMs(policy)` for as long as the process lives. A
 * refresh that changes the interval (or the `runAgainOn` value) re-arms the
 * timer once; one that changes neither leaves it running where it was. The
 * timer does not hold the event loop open, so a shutdown does not wait for the
 * next run. Returns the stop.
 */
export function startPolicyTimer(
  task: () => void,
  { intervalMs, runAgainOn }: PolicyTimerOptions
): () => void {
  const arm = (policy: InstancePolicy) => every(task, intervalMs(policy));

  let disarm = arm(instancePolicy());

  const unsubscribe = onInstancePolicyChange((next, previous) => {
    const runAgain =
      runAgainOn !== undefined &&
      !Object.is(runAgainOn(next), runAgainOn(previous));
    if (!runAgain && intervalMs(next) === intervalMs(previous)) return;

    disarm();
    disarm = arm(next);
    if (runAgain) task();
  });

  return () => {
    unsubscribe();
    disarm();
  };
}
