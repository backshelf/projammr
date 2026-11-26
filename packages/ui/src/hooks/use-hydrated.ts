import * as React from "react";

const noStoreChanges = () => () => {};

/**
 * Whether the client has taken over the markup the server rendered. It is
 * false for the server render and the hydration pass that must match it, and
 * true from then on, including on the first render of anything mounted after
 * hydration. Browser-only state (the viewport, the URL) is read once this is
 * true, so it never makes the first client render disagree with the server's.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noStoreChanges,
    () => true,
    () => false
  );
}
