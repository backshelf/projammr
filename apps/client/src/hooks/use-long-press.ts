import { useHaptics } from "@workspace/ui/components/haptics";
import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent } from "react";

export type LongPressOptions = {
  /** How long a finger must rest before the press counts. */
  ms?: number;
  /** How far it may drift first — past this the gesture was a scroll. */
  slop?: number;
  /** Buzzes when the press lands. Supplied by the caller, because the
   *  device's haptics are React context and this is a plain factory. */
  haptic?: () => void;
  /** Told while a finger is resting on the element: true from the moment it
   *  lands, false again when the press fires, drifts off or lifts. */
  onPressingChange?: (pressing: boolean) => void;
};

export type LongPressHandlers = {
  onPointerDown: (event: LongPressPoint) => void;
  onPointerMove: (event: LongPressPoint) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
  /** Swallows the click a finger leaves behind once the press has fired. */
  onClickCapture: (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
  /** Drops a press still counting down, for a component leaving the tree. */
  cancel: () => void;
};

/**
 * Drops a text range the browser has already started under the finger. WebKit
 * begins selecting a word well before a press completes, and that range
 * outlives the gesture — it would sit highlighted behind the sheet the press
 * opens.
 */
function dropTextSelection() {
  if (typeof window === "undefined") return;
  window.getSelection()?.removeAllRanges();
}

/** The part of a pointer event a press is decided from. */
export type LongPressPoint = {
  pointerType: string;
  clientX: number;
  clientY: number;
};

/**
 * A press-and-hold gesture, as the handlers to spread onto an element.
 *
 * Only a finger can long-press: a mouse has the right-click menu and a
 * keyboard has the `⋯` button, so watching either here would fire the sheet
 * on an ordinary click. The context menu is suppressed because iOS raises it
 * at roughly the same moment the press completes, and the sheet is what
 * answers the gesture. Lifting the finger afterwards still dispatches a click
 * on whatever was under it, so that one click is swallowed too, or the card's
 * link would navigate away from the sheet it just opened.
 */
export function longPressHandlers(
  onLongPress: () => void,
  { ms = 450, slop = 8, haptic, onPressingChange }: LongPressOptions = {}
): LongPressHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  let pressing = false;

  const setPressing = (next: boolean) => {
    if (pressing === next) return;
    pressing = next;
    onPressingChange?.(next);
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    origin = null;
    setPressing(false);
  };

  return {
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return;
      origin = { x: event.clientX, y: event.clientY };
      fired = false;
      setPressing(true);
      timer = setTimeout(() => {
        cancel();
        fired = true;
        dropTextSelection();
        // The card settles under the finger for the hold; the buzz marks the
        // moment it counted, before the sheet has drawn.
        haptic?.();
        onLongPress();
      }, ms);
    },
    onPointerMove: (event) => {
      if (!origin) return;
      const drift = Math.hypot(
        event.clientX - origin.x,
        event.clientY - origin.y
      );
      if (drift > slop) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event) => event.preventDefault(),
    onClickCapture: (event) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopPropagation();
    },
    cancel,
  };
}

/**
 * `longPressHandlers` for a component, dropping a press still counting down
 * when the element leaves. The timing is the gesture's own definition rather
 * than a caller's choice, so every surface that press-and-holds feels the
 * same; pass a stable `onLongPress`, since a new one starts the gesture over.
 */
export function useLongPress(onLongPress: () => void): {
  handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (event: MouseEvent) => void;
    onClickCapture: (event: MouseEvent) => void;
  };
  /** Whether a finger is resting on the element right now, so the surface it
   *  drives can answer the hold while it lasts. */
  pressing: boolean;
} {
  const haptic = useHaptics();
  const [pressing, setPressing] = useState(false);
  const handlers = useMemo(
    () =>
      longPressHandlers(onLongPress, { haptic, onPressingChange: setPressing }),
    [onLongPress, haptic]
  );

  useEffect(() => handlers.cancel, [handlers]);

  return {
    handlers: {
      onPointerDown: handlers.onPointerDown,
      onPointerMove: handlers.onPointerMove,
      onPointerUp: handlers.onPointerUp,
      onPointerCancel: handlers.onPointerCancel,
      onContextMenu: handlers.onContextMenu,
      onClickCapture: handlers.onClickCapture,
    },
    pressing,
  };
}
