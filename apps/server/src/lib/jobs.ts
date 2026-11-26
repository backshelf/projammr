import { instancePolicy, onInstancePolicyChange } from "./instance-policy.js";
import { errorFields, log } from "./log.js";

type Task = () => Promise<void>;

const logger = log("queue");

/**
 * Runs queued tasks with bounded concurrency. Tasks are keyed so the same work
 * is never queued twice while it is pending or running — a read path that
 * enqueues whenever a column is null would otherwise queue a copy per request.
 * Errors are the task's to handle; an unhandled one is logged and dropped so a
 * bad file cannot stall the queue.
 */
export class TaskQueue {
  private readonly pending: { key: string; run: Task }[] = [];
  private readonly active = new Set<string>();
  private readonly idleWaiters: (() => void)[] = [];
  private readonly keyWaiters = new Map<string, (() => void)[]>();

  constructor(private limit: number) {}

  /** How many tasks may run at once. */
  get concurrency(): number {
    return this.limit;
  }

  /**
   * Changes how many tasks may run at once. A raise starts pending tasks
   * straight away; a cut stops nothing already running — those finish, and no
   * pending task starts until the running count is under the new limit.
   */
  setConcurrency(limit: number): void {
    this.limit = limit;
    this.drain();
  }

  enqueue(key: string, run: Task): void {
    if (this.holds(key)) return;
    this.pending.push({ key, run });
    this.drain();
  }

  get size() {
    return this.active.size + this.pending.length;
  }

  /** 1-based place of a pending key, or null if it is running or unknown. */
  position(key: string): number | null {
    const index = this.pending.findIndex((t) => t.key === key);
    return index === -1 ? null : index + 1;
  }

  /** Drops a pending task. A running one cannot be dropped, so that is false. */
  remove(key: string): boolean {
    const index = this.pending.findIndex((t) => t.key === key);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    this.release(key);
    return true;
  }

  /** Every pending key, in the order the tasks will start. */
  pendingKeys(): string[] {
    return this.pending.map((t) => t.key);
  }

  /** Resolves once nothing is pending or running. */
  idle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Resolves once `key` is neither pending nor running, or at once for a key
   * the queue does not hold. A key enqueued again while it runs is coalesced
   * into that run, so it settles when the run does; a removed key settles on
   * removal.
   */
  settled(key: string): Promise<void> {
    if (!this.holds(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.keyWaiters.get(key);
      if (waiters) waiters.push(resolve);
      else this.keyWaiters.set(key, [resolve]);
    });
  }

  private holds(key: string): boolean {
    return this.active.has(key) || this.pending.some((t) => t.key === key);
  }

  private release(key: string): void {
    const waiters = this.keyWaiters.get(key);
    if (!waiters || this.holds(key)) return;
    this.keyWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }

  private drain(): void {
    while (this.active.size < this.limit && this.pending.length > 0) {
      const { key, run } = this.pending.shift()!;
      this.active.add(key);
      // `run` is called inside the loop rather than awaited, so a synchronous
      // throw has to be caught here too or it would escape `drain`.
      void (async () => run())()
        .catch((err) =>
          logger.error("task failed", { key, ...errorFields(err) })
        )
        .finally(() => {
          this.active.delete(key);
          this.release(key);
          this.drain();
        });
    }

    if (this.size === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}

/**
 * Every background job runs here, at the instance's `jobs.analysisWorkers`
 * at a time, followed as the policy changes.
 */
export const mediaQueue = new TaskQueue(instancePolicy().jobs.analysisWorkers);

onInstancePolicyChange((policy) =>
  mediaQueue.setConcurrency(policy.jobs.analysisWorkers)
);
