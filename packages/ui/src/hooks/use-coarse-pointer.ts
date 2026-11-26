import * as React from "react";

const QUERY = "(pointer: coarse)";

/**
 * Whether the primary pointer is coarse right now, for code outside React.
 * False wherever there is no `window` or no `matchMedia` to ask — SSR, and a
 * test environment with no DOM at all — rather than throwing.
 */
export const isCoarsePointer = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(QUERY).matches;

const subscribe = (onChange: () => void): (() => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/**
 * Whether the primary pointer is coarse. The `coarse:` Tailwind variant is
 * the CSS side of the same query and covers anything a stylesheet can reach;
 * this is for the rare case JS needs the answer too, such as a placeholder
 * string, which no CSS selector can touch.
 */
export function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    isCoarsePointer,
    // The server has no pointer to read; fine is what it renders.
    () => false
  );
}
