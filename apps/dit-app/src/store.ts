import type { UnlistenFn } from "@tauri-apps/api/event";

import { call, onState } from "./bridge";
import type { Snapshot } from "./ipc";

export type SnapshotState = {
  /** The app's latest snapshot; null until the first one arrives. */
  snapshot: Snapshot | null;
  /** Why `get_snapshot` failed, while no snapshot has arrived by any other way. */
  error: string | null;
};

/** What a webview subscribes to: the whole state, shaped for `useSyncExternalStore`. */
export type PushedStore<State> = {
  subscribe: (listener: () => void) => () => void;
  getState: () => State;
};

export type SnapshotStore = PushedStore<SnapshotState>;

/** Where a store's state comes from and what shape it keeps it in. */
export type PushedSource<Value, State> = {
  /** The state before anything has arrived. */
  initial: State;
  /** Calls `handler` with the whole value each time the app pushes one. */
  listen: (handler: (value: Value) => void) => Promise<UnlistenFn>;
  /** Asks the app for the value as it stands. */
  read: () => Promise<Value>;
  /** The state for a value that has arrived; `previous` lets a source keep what did not change (the same objects). */
  have: (value: Value, previous: State) => State;
  failed: (reason: string) => State;
};

/**
 * A webview's one copy of a whole-state push from the app (the panel's snapshot, the backfill window's view). It
 * listens while anything subscribes: the event first, then the read, so no push falls between the two; a push that
 * lands before the answer is newer than it and wins.
 */
export function createPushedStore<Value, State>(
  source: PushedSource<Value, State>
): PushedStore<State> {
  let state = source.initial;
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;

  function set(next: State): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function start(): () => void {
    let live = true;
    let pushed = false;
    const unlisten = source.listen((value) => {
      pushed = true;
      set(source.have(value, state));
    });
    source.read().then(
      (value) => {
        if (live && !pushed) set(source.have(value, state));
      },
      (reason: unknown) => {
        if (live && !pushed) set(source.failed(String(reason)));
      }
    );
    return () => {
      live = false;
      void unlisten.then((off) => off());
    };
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      stop ??= start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
    getState: () => state,
  };
}

/** The panel's one copy of the app's snapshot: `dit://state`, then `get_snapshot`. */
export function createSnapshotStore(): SnapshotStore {
  return createPushedStore<Snapshot, SnapshotState>({
    initial: { snapshot: null, error: null },
    listen: onState,
    read: () => call("get_snapshot"),
    have: (snapshot) => ({ snapshot, error: null }),
    failed: (reason) => ({ snapshot: null, error: reason }),
  });
}

export const snapshotStore = createSnapshotStore();
