import * as React from "react";

const neverChanges = (): (() => void) => () => {};

/**
 * Whether the browser is running on an Apple platform, where a keyboard
 * shortcut's modifier reads as ⌘ rather than Ctrl. The platform never changes
 * after mount, so the subscription is a no-op; `useSyncExternalStore` still
 * earns its keep by keeping the server's guess (the majority key) distinct
 * from the client's real answer, so hydration never mismatches.
 */
export function useIsApplePlatform(): boolean {
  return React.useSyncExternalStore(
    neverChanges,
    () => /Mac|iPhone|iPod|iPad/.test(navigator.userAgent),
    () => false
  );
}
