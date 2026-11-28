"use client";

import { useSyncExternalStore } from "react";

export type TrackStudioActions = {
  openStudio: () => void;
  openInDaw: (() => void) | null;
};

let current: TrackStudioActions | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function registerTrackStudioActions(
  actions: TrackStudioActions
): () => void {
  current = actions;
  emit();
  return () => {
    if (current === actions) {
      current = null;
      emit();
    }
  };
}

export function useTrackStudioActions(): TrackStudioActions | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null
  );
}
