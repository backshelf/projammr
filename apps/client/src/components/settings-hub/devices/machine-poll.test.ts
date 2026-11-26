import { describe, expect, it, spyOn } from "bun:test";
import type { ActionError } from "@workspace/api/lib/action-result";
import { createMachinePoll, MACHINE_POLL_MS } from "./machine-poll";

/** A poll over a hand-driven clock and reads that answer only when told to. */
function harness() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const answers: ((value: string[] | ActionError) => void)[] = [];
  const shown: string[][] = [];

  const poll = createMachinePoll<string[]>({
    read: () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
    onRead: (value) => shown.push(value),
    setTimeout: (run, ms) => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  });

  return {
    poll,
    shown,
    /** How many reads have gone out. */
    get reads() {
      return answers.length;
    },
    /** Answers the `index`th read, then lets its follow-ups run. */
    async answer(index: number, value: string[] | ActionError) {
      answers[index]!(value);
      await Promise.resolve();
      await Promise.resolve();
    },
    /** Moves the clock on, firing every timer that falls due. */
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

describe("createMachinePoll", () => {
  it("reads every 30 s while visible, starting from the list it was given", async () => {
    const clock = harness();
    clock.poll.start();

    clock.advance(MACHINE_POLL_MS - 1);
    expect(clock.reads).toBe(0);
    clock.advance(1);
    expect(clock.reads).toBe(1);

    await clock.answer(0, ["a"]);
    expect(clock.shown).toEqual([["a"]]);
    clock.advance(MACHINE_POLL_MS);
    expect(clock.reads).toBe(2);
  });

  it("reads nothing while hidden, and at once when shown again", async () => {
    const clock = harness();
    clock.poll.start();
    clock.poll.setVisible(false);

    clock.advance(MACHINE_POLL_MS * 4);
    expect(clock.reads).toBe(0);
    expect(clock.pending).toBe(0);

    clock.poll.setVisible(true);
    expect(clock.reads).toBe(1);
    await clock.answer(0, ["a"]);
    expect(clock.pending).toBe(1);
  });

  it("starts hidden without reading until shown", () => {
    const clock = harness();
    clock.poll.setVisible(false);
    clock.poll.start();

    clock.advance(MACHINE_POLL_MS * 2);
    expect(clock.reads).toBe(0);
  });

  it("keeps one read out at a time, reading once more after one asked for meanwhile", async () => {
    const clock = harness();
    clock.poll.start();
    clock.poll.refresh();
    clock.poll.refresh();
    clock.poll.setVisible(false);
    clock.poll.setVisible(true);
    expect(clock.reads).toBe(1);

    await clock.answer(0, ["before the change"]);
    expect(clock.reads).toBe(2);

    await clock.answer(1, ["after the change"]);
    expect(clock.reads).toBe(2);
    expect(clock.shown.at(-1)).toEqual(["after the change"]);
    expect(clock.pending).toBe(1);
  });

  it("keeps what it shows when a read fails, and tries again on schedule", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const clock = harness();
    clock.poll.start();
    clock.poll.refresh();

    await clock.answer(0, { error: "Network error" });
    expect(clock.shown).toEqual([]);
    clock.advance(MACHINE_POLL_MS);
    expect(clock.reads).toBe(2);
    warn.mockRestore();
  });

  it("drops a read that answers after it stopped, and schedules nothing", async () => {
    const clock = harness();
    clock.poll.start();
    clock.poll.refresh();
    clock.poll.stop();

    await clock.answer(0, ["gone"]);
    expect(clock.shown).toEqual([]);
    expect(clock.pending).toBe(0);
    clock.poll.refresh();
    expect(clock.reads).toBe(1);
  });

  it("reads again for an ask made after a restart, not for the stale read", async () => {
    const clock = harness();
    clock.poll.start();
    clock.poll.refresh();
    clock.poll.stop();
    clock.poll.start();
    clock.poll.refresh();
    expect(clock.reads).toBe(1);

    await clock.answer(0, ["stale"]);
    expect(clock.shown).toEqual([]);
    expect(clock.reads).toBe(2);
    await clock.answer(1, ["fresh"]);
    expect(clock.shown).toEqual([["fresh"]]);
  });
});
