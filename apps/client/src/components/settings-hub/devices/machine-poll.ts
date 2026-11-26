import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";

/** How often an open Machines section reads the machine list again. */
export const MACHINE_POLL_MS = 30_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type MachinePollDeps<T> = {
  read: () => Promise<T | ActionError>;
  /** A read that answered; a failed one keeps what is shown and waits for the next. */
  onRead: (value: T) => void;
  setTimeout: (run: () => void, ms: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle) => void;
};

/**
 * Keeps a list current while it is on screen: a read every `MACHINE_POLL_MS`
 * while the page is visible and nothing while it is hidden, a read at once
 * when it shows again or when a change asks for one (`refresh`), and never
 * two reads at a time: asked for one while another is out, it reads once
 * more when that one answers, so what it shows is never older than the ask.
 *
 * Every side effect is injected, so the whole machine runs under a fake clock
 * with no DOM and no network.
 */
export function createMachinePoll<T>(deps: MachinePollDeps<T>) {
  let running = false;
  let visible = true;
  let reading = false;
  let again = false;
  let timer: TimerHandle | null = null;
  // Bumped on every stop, so a read that was out when the list stopped
  // showing cannot hand its answer to a list that is gone.
  let epoch = 0;

  const cancel = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    cancel();
    if (running && visible) {
      timer = deps.setTimeout(() => void read(), MACHINE_POLL_MS);
    }
  };

  const read = async () => {
    cancel();
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    again = false;
    const started = epoch;
    const result = await deps
      .read()
      .catch((error: unknown): ActionError => ({ error: String(error) }));
    reading = false;
    if (started === epoch) {
      if (isActionError(result)) {
        console.warn("Could not re-read your machines:", result.error);
      } else {
        deps.onRead(result);
      }
    }
    if (!running) return;
    if (again) void read();
    else if (started === epoch) schedule();
  };

  return {
    /** Starts reading every `MACHINE_POLL_MS`; the list it starts from is fresh. */
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    /** Stops every read; one still out is dropped when it answers. */
    stop() {
      running = false;
      again = false;
      epoch += 1;
      cancel();
    },
    /** Stops reading while hidden; reads at once on show. */
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (!running) return;
      if (next) void read();
      else cancel();
    },
    /** Reads now: something changed that the list should show. */
    refresh() {
      if (running) void read();
    },
  };
}
