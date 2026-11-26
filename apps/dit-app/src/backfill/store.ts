import { useSyncExternalStore } from "react";

import type { BackfillView } from "../backfill-ipc";
import { callBackfill, onBackfill } from "../bridge";
import { createPushedStore, type PushedStore } from "../store";
import { shareStructure } from "./share";

export type BackfillState = {
  /** The app's latest view; null until the first one arrives. */
  view: BackfillView | null;
  /** Why `get_backfill` failed, while no view has arrived by any other way. */
  error: string | null;
};

export type BackfillStore = PushedStore<BackfillState>;

/** The window's one copy of the app's view: `dit://backfill`, then `get_backfill`. */
export function createBackfillStore(): BackfillStore {
  return createPushedStore<BackfillView, BackfillState>({
    initial: { view: null, error: null },
    listen: onBackfill,
    read: () => callBackfill("get_backfill"),
    have: (view, previous) => ({
      view: shareStructure(previous.view, view),
      error: null,
    }),
    failed: (reason) => ({ view: null, error: reason }),
  });
}

const backfillStore = createBackfillStore();

/** The app's latest backfill view, and why there is none yet when `get_backfill` failed. */
export function useBackfill(
  store: BackfillStore = backfillStore
): BackfillState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
