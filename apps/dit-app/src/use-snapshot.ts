import { useSyncExternalStore } from "react";

import { snapshotStore, type SnapshotState } from "./store";

/** The app's latest snapshot, and why there is none yet when `get_snapshot` failed. */
export function useSnapshot(): SnapshotState {
  return useSyncExternalStore(snapshotStore.subscribe, snapshotStore.getState);
}
