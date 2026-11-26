import * as React from "react";

/**
 * The width below which the app is a phone. The `phone:` variant in the ui
 * globals is the CSS side of the same line, and both sit on Tailwind's `md`
 * floor so a layout never reads as half phone, half desktop.
 */
export const MOBILE_BREAKPOINT = 768;

const subscribe = (onChange: () => void): (() => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    // The server has no viewport; desktop is the layout it renders.
    () => false
  );
}
