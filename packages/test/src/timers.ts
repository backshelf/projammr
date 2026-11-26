import { jest } from "bun:test";

/** Resolves once every queued microtask has run: `setImmediate` is not faked by `jest.useFakeTimers`. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Advances fake timers by `ms`, letting promises settle between ticks, so a
 * timer scheduled by a callback that awaited something still fires inside the
 * window — `jest.advanceTimersByTime` only fires timers pending when it is
 * called. `bun:test` cannot report when the next timer is due, so the clock
 * moves a millisecond at a time and stops early once no timer is left.
 */
export async function advanceTimersByTimeAsync(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed++) {
    await settle();
    if (jest.getTimerCount() === 0) break;
    jest.advanceTimersByTime(1);
  }
  await settle();
}
