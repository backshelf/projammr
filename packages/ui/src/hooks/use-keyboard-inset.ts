import * as React from "react";

/**
 * How much of the layout viewport the soft keyboard covers. On a platform
 * that shrinks the layout viewport itself (`interactive-widget=resizes-content`
 * on Android) the visual and layout viewports agree and this is 0; on iOS the
 * visual viewport is both shorter and pushed down, and the difference is the
 * keyboard.
 */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number }
): number {
  return Math.max(
    0,
    Math.round(layoutHeight - (visual.height + visual.offsetTop))
  );
}

const subscribe = (onChange: () => void): (() => void) => {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
};

const read = () => {
  const vv = window.visualViewport;
  return vv ? keyboardInset(window.innerHeight, vv) : 0;
};

/**
 * How many pixels of the layout viewport the soft keyboard currently covers,
 * live over `visualViewport`'s `resize` and `scroll` events. A hardware
 * keyboard covers nothing, so this stays 0; `focusin` is deliberately not the
 * signal, since it fires for buttons and programmatic focus and reports
 * intent rather than height.
 */
export function useKeyboardInset(): number {
  return React.useSyncExternalStore(subscribe, read, () => 0);
}
