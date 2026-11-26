import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { DEFAULT_INSTANCE_POLICY } from "./instance-policy.js";
import { mediaQueue, TaskQueue } from "./jobs.js";

/** A task that only settles when the returned trigger is called. */
function deferred() {
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => (settle = resolve));
  return { promise, settle };
}

/** Lets every queued continuation run before the assertion that follows. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TaskQueue", () => {
  it("runs no more than `concurrency` tasks at once", async () => {
    const queue = new TaskQueue(2);
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];

    gates.forEach((gate, i) => {
      queue.enqueue(`task-${i}`, () => {
        started.push(i);
        return gate.promise;
      });
    });

    expect(started).toEqual([0, 1]);

    gates[0]!.settle();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    for (const gate of gates.slice(1)) gate.settle();
    await queue.idle();
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("starts pending tasks as soon as the limit is raised", () => {
    const queue = new TaskQueue(1);
    const gates = Array.from({ length: 3 }, deferred);
    const started: number[] = [];
    gates.forEach((gate, i) => {
      queue.enqueue(`raised-${i}`, () => {
        started.push(i);
        return gate.promise;
      });
    });
    expect(started).toEqual([0]);

    queue.setConcurrency(3);

    expect(queue.concurrency).toBe(3);
    expect(started).toEqual([0, 1, 2]);
    for (const gate of gates) gate.settle();
  });

  it("lets running tasks finish when the limit is cut, and starts the next under the new one", async () => {
    const queue = new TaskQueue(3);
    const gates = Array.from({ length: 4 }, deferred);
    const started: number[] = [];
    gates.forEach((gate, i) => {
      queue.enqueue(`cut-${i}`, () => {
        started.push(i);
        return gate.promise;
      });
    });
    expect(started).toEqual([0, 1, 2]);

    queue.setConcurrency(1);

    // Two finish; one is still running, which is the whole new allowance.
    gates[0]!.settle();
    gates[1]!.settle();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.settle();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3]!.settle();
    await queue.idle();
  });

  it("gives the media queue the instance's worker count, and follows it", () => {
    expect(mediaQueue.concurrency).toBe(
      DEFAULT_INSTANCE_POLICY.jobs.analysisWorkers
    );
    try {
      stubInstancePolicy({ jobs: { analysisWorkers: 5 } });
      expect(mediaQueue.concurrency).toBe(5);
    } finally {
      restoreInstancePolicy();
    }
    expect(mediaQueue.concurrency).toBe(
      DEFAULT_INSTANCE_POLICY.jobs.analysisWorkers
    );
  });

  it("coalesces a key that is already pending or running", async () => {
    const queue = new TaskQueue(1);
    const blocker = deferred();
    const run = mock(async () => {});

    queue.enqueue("blocker", () => blocker.promise);
    queue.enqueue("same", run);
    queue.enqueue("same", run);
    expect(queue.size).toBe(2);

    blocker.settle();
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(1);

    // Once it has settled the key is free again, so a later change can requeue.
    queue.enqueue("same", run);
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs a rejecting task and keeps going", async () => {
    const errors = spyOn(process.stderr, "write").mockImplementation(
      () => true
    );
    const queue = new TaskQueue(1);
    const after = mock(async () => {});

    queue.enqueue("bad", async () => {
      throw new Error("unreadable file");
    });
    queue.enqueue("good", after);
    await queue.idle();

    expect(after).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('[queue] task failed key="bad"')
    );
    errors.mockRestore();
  });

  it("reads each pending key's place and renumbers as tasks start", async () => {
    const queue = new TaskQueue(1);
    const gates = Array.from({ length: 3 }, deferred);
    gates.forEach((gate, i) => queue.enqueue(`task-${i}`, () => gate.promise));

    expect(queue.position("task-0")).toBeNull();
    expect(queue.pendingKeys()).toEqual(["task-1", "task-2"]);
    expect(queue.position("task-1")).toBe(1);
    expect(queue.position("task-2")).toBe(2);
    expect(queue.position("unknown")).toBeNull();

    gates[0]!.settle();
    await flush();
    expect(queue.position("task-1")).toBeNull();
    expect(queue.position("task-2")).toBe(1);

    for (const gate of gates.slice(1)) gate.settle();
    await queue.idle();
  });

  it("removes a pending task but never a running one", async () => {
    const queue = new TaskQueue(1);
    const blocker = deferred();
    const dropped = mock(async () => {});

    queue.enqueue("running", () => blocker.promise);
    queue.enqueue("pending", dropped);

    expect(queue.remove("running")).toBe(false);
    expect(queue.remove("pending")).toBe(true);
    expect(queue.remove("pending")).toBe(false);
    expect(queue.pendingKeys()).toEqual([]);

    blocker.settle();
    await queue.idle();
    expect(dropped).not.toHaveBeenCalled();
  });

  it("idle() resolves immediately on an empty queue", async () => {
    const queue = new TaskQueue(2);
    let resolved = false;
    void queue.idle().then(() => (resolved = true));

    await flush();
    expect(resolved).toBe(true);
    expect(queue.size).toBe(0);
  });

  it("idle() waits for the last task to settle", async () => {
    const queue = new TaskQueue(2);
    const gate = deferred();
    let resolved = false;

    queue.enqueue("slow", () => gate.promise);
    void queue.idle().then(() => (resolved = true));

    await flush();
    expect(resolved).toBe(false);

    gate.settle();
    await queue.idle();
    await flush();
    expect(resolved).toBe(true);
  });

  it("settled() resolves immediately for a key the queue does not hold", async () => {
    const queue = new TaskQueue(1);
    const blocker = deferred();
    queue.enqueue("other", () => blocker.promise);
    let resolved = false;
    void queue.settled("unknown").then(() => (resolved = true));

    await flush();
    expect(resolved).toBe(true);

    blocker.settle();
    await queue.idle();
  });

  it("settled() waits for its own key, not for the rest of the queue", async () => {
    const queue = new TaskQueue(2);
    const mine = deferred();
    const other = deferred();
    let resolved = false;

    queue.enqueue("mine", () => mine.promise);
    queue.enqueue("other", () => other.promise);
    void queue.settled("mine").then(() => (resolved = true));

    await flush();
    expect(resolved).toBe(false);

    mine.settle();
    await flush();
    expect(resolved).toBe(true);
    expect(queue.size).toBe(1);

    other.settle();
    await queue.idle();
  });

  it("settled() waits through a key's time pending and running", async () => {
    const queue = new TaskQueue(1);
    const blocker = deferred();
    const mine = deferred();
    let resolved = false;

    queue.enqueue("blocker", () => blocker.promise);
    queue.enqueue("mine", () => mine.promise);
    void queue.settled("mine").then(() => (resolved = true));

    blocker.settle();
    await flush();
    expect(queue.pendingKeys()).toEqual([]);
    expect(resolved).toBe(false);

    mine.settle();
    await flush();
    expect(resolved).toBe(true);
  });

  it("settled() resolves when a key re-enqueued while running finishes its one run", async () => {
    const queue = new TaskQueue(1);
    const gate = deferred();
    const run = mock(() => gate.promise);
    let resolved = false;

    queue.enqueue("mine", run);
    void queue.settled("mine").then(() => (resolved = true));
    queue.enqueue("mine", run);

    gate.settle();
    await flush();
    expect(resolved).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it("settled() resolves when its pending key is removed", async () => {
    const queue = new TaskQueue(1);
    const blocker = deferred();
    let resolved = false;

    queue.enqueue("blocker", () => blocker.promise);
    queue.enqueue("mine", async () => {});
    void queue.settled("mine").then(() => (resolved = true));

    expect(queue.remove("mine")).toBe(true);
    await flush();
    expect(resolved).toBe(true);

    blocker.settle();
    await queue.idle();
  });

  it("settled() resolves after a rejecting task", async () => {
    const errors = spyOn(process.stderr, "write").mockImplementation(
      () => true
    );
    const queue = new TaskQueue(1);
    queue.enqueue("bad", async () => {
      throw new Error("unreadable file");
    });

    await queue.settled("bad");
    expect(queue.size).toBe(0);
    errors.mockRestore();
  });
});
