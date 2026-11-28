import * as React from "react";

const MIN_KEYBOARD_DROP_PX = 120;
const PRE_FOCUS_RESIZE_WINDOW_MS = 500;

const NON_KEYBOARD_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether `el` is a text/form control that opens a soft keyboard when focused.
 */
export function isEditableElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return !NON_KEYBOARD_INPUT_TYPES.has(type);
  }
  const ce = el.getAttribute("contenteditable");
  if (ce !== null) return ce.toLowerCase() !== "false";
  return (el as HTMLElement).isContentEditable === true;
}

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

let baselineHeight = 0;
let baselineWidth = 0;
let lastHeight = 0;
let keyboardActive = false;
let provisionalBaseline = false;
let blurPending = false;
let recentShrink: {
  width: number;
  baseline: number;
  timestamp: number;
} | null = null;
const baselinesByWidth = new Map<number, number>();
const listeners = new Set<() => void>();

let detachDomListeners: (() => void) | null = null;

const currentEditable = (): boolean => {
  if (blurPending || typeof document === "undefined") return false;
  return isEditableElement(document.activeElement);
};

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const syncBaseline = (width: number, height: number) => {
  const editable = currentEditable();

  if (baselineHeight === 0) {
    baselineWidth = width;
    baselineHeight = height;
    lastHeight = height;
    baselinesByWidth.set(width, height);
    return;
  }

  if (width !== baselineWidth) {
    recentShrink = null;
    baselineWidth = width;
    const known = baselinesByWidth.get(width);

    if (known !== undefined) {
      if (height >= known || !editable) {
        baselineHeight = height;
        baselinesByWidth.set(width, height);
        keyboardActive = false;
      } else {
        baselineHeight = known;
        keyboardActive = known - height >= MIN_KEYBOARD_DROP_PX;
      }
      provisionalBaseline = false;
    } else if (editable && keyboardActive) {
      const screenAvailW = window.screen?.availWidth ?? 0;
      const screenAvailH = window.screen?.availHeight ?? 0;
      if (
        screenAvailW > 0 &&
        Math.abs(screenAvailW - width) <= 20 &&
        screenAvailH > height
      ) {
        baselineHeight = screenAvailH;
        baselinesByWidth.set(width, screenAvailH);
        provisionalBaseline = false;
      } else {
        provisionalBaseline = true;
      }
      keyboardActive = baselineHeight - height >= MIN_KEYBOARD_DROP_PX;
    } else {
      baselineHeight = height;
      baselinesByWidth.set(width, height);
      keyboardActive = false;
      provisionalBaseline = false;
    }

    lastHeight = height;
    return;
  }

  if (provisionalBaseline) {
    if (
      height - lastHeight >= MIN_KEYBOARD_DROP_PX ||
      !editable ||
      height > baselineHeight
    ) {
      baselineHeight = height;
      baselinesByWidth.set(width, height);
      provisionalBaseline = false;
      keyboardActive = false;
    }
    lastHeight = height;
    return;
  }

  if (height >= baselineHeight) {
    baselineHeight = height;
    baselinesByWidth.set(width, height);
    keyboardActive = false;
    recentShrink = null;
  } else if (!editable) {
    const now = Date.now();
    const activeBaseline =
      recentShrink !== null &&
      recentShrink.width === width &&
      now - recentShrink.timestamp <= PRE_FOCUS_RESIZE_WINDOW_MS
        ? recentShrink.baseline
        : baselineHeight;
    recentShrink =
      activeBaseline - height >= MIN_KEYBOARD_DROP_PX
        ? {
            width,
            baseline: activeBaseline,
            timestamp:
              activeBaseline === baselineHeight ? now : recentShrink!.timestamp,
          }
        : null;
    baselineHeight = height;
    baselinesByWidth.set(width, height);
    keyboardActive = false;
  } else {
    keyboardActive = baselineHeight - height >= MIN_KEYBOARD_DROP_PX;
  }

  lastHeight = height;
};

const attach = () => {
  const width = window.innerWidth ?? 0;
  const height = window.innerHeight;
  baselineWidth = width;
  baselineHeight = height;
  lastHeight = height;
  baselinesByWidth.clear();
  baselinesByWidth.set(width, height);
  keyboardActive = false;
  provisionalBaseline = false;
  blurPending = false;
  recentShrink = null;

  const vv = window.visualViewport;
  const handleResize = () => {
    blurPending = false;
    syncBaseline(window.innerWidth ?? 0, window.innerHeight);
    notify();
  };
  const handleFocusIn = () => {
    blurPending = false;
    const widthNow = window.innerWidth ?? 0;
    const heightNow = window.innerHeight;
    if (isEditableElement(document.activeElement)) {
      if (
        recentShrink !== null &&
        recentShrink.width === widthNow &&
        Date.now() - recentShrink.timestamp <= PRE_FOCUS_RESIZE_WINDOW_MS &&
        recentShrink.baseline - heightNow >= MIN_KEYBOARD_DROP_PX
      ) {
        baselineHeight = recentShrink.baseline;
        baselinesByWidth.set(widthNow, recentShrink.baseline);
        provisionalBaseline = false;
        keyboardActive = true;
      } else if (
        baselineHeight > 0 &&
        baselineHeight - heightNow >= MIN_KEYBOARD_DROP_PX
      ) {
        keyboardActive = true;
      }
    }
    recentShrink = null;
    notify();
  };
  const handleFocusOut = (event: FocusEvent) => {
    const related = event.relatedTarget as Element | null;
    blurPending = related ? !isEditableElement(related) : true;
    if (blurPending) {
      keyboardActive = false;
      recentShrink = null;
    }
    notify();
  };

  vv?.addEventListener("resize", handleResize);
  vv?.addEventListener("scroll", handleResize);
  window.addEventListener("resize", handleResize);
  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("focusout", handleFocusOut);

  detachDomListeners = () => {
    vv?.removeEventListener("resize", handleResize);
    vv?.removeEventListener("scroll", handleResize);
    window.removeEventListener("resize", handleResize);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
    baselineHeight = 0;
    baselineWidth = 0;
    lastHeight = 0;
    baselinesByWidth.clear();
    keyboardActive = false;
    provisionalBaseline = false;
    blurPending = false;
    recentShrink = null;
    detachDomListeners = null;
  };
};

const subscribe = (onChange: () => void): (() => void) => {
  const wasEmpty = listeners.size === 0;
  listeners.add(onChange);
  if (wasEmpty) {
    attach();
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      detachDomListeners?.();
    }
  };
};

const read = () => {
  const vv = window.visualViewport;
  const vvInset = vv ? keyboardInset(window.innerHeight, vv) : 0;
  if (vvInset > 0) return vvInset;

  if (!currentEditable() || baselineHeight === 0) return 0;
  const drop = Math.round(baselineHeight - window.innerHeight);
  return drop >= MIN_KEYBOARD_DROP_PX ? drop : 0;
};

/**
 * How many pixels of the layout viewport the soft keyboard currently covers,
 * live over `visualViewport`'s `resize` and `scroll` events (iOS) as well as
 * `window` `resize` drops relative to a stable baseline while an editable
 * element is focused (Android `interactive-widget=resizes-content`).
 */
export function useKeyboardInset(): number {
  return React.useSyncExternalStore(subscribe, read, () => 0);
}
