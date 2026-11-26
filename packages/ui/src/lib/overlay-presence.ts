"use client";

import {
  createContext,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** The part of a Base UI change event the presence plumbing reads. */
type OpenChangeDetails = {
  reason: string;
  isCanceled?: boolean;
  preventUnmountOnClose?: () => void;
};

type OverlayActions = { unmount: () => void };

export type OverlayPresence = {
  open: boolean;
  /** Why the overlay last opened or closed, for an exit that depends on it. */
  reason: () => string | undefined;
  /** Base UI's imperative handle on the Root. */
  actionsRef: RefObject<OverlayActions | null>;
  /**
   * For `AnimatePresence onExitComplete`: tells Base UI the exit has finished
   * so it releases focus, scroll lock and the page's `aria-hidden` then.
   */
  onExitComplete: () => void;
};

/**
 * Open state for a Base UI overlay whose enter and exit Motion animates.
 *
 * Returns the props for the primitive's Root and the presence value its
 * content reads. `D` and `A` are the primitive's change-event details and
 * imperative actions (`Dialog.Root.ChangeEventDetails`,
 * `Dialog.Root.Actions`). Open is controlled-or-uncontrolled and mirrored,
 * so the content drives `AnimatePresence` from the same value the primitive
 * sees.
 *
 * Motion runs `scale` and `y` on the main thread, where Base UI's
 * `getAnimations()` wait cannot see them, and schedules even its `opacity`
 * animation on its next frame, after Base UI has already looked for
 * running animations. So a close Base UI reports
 * calls `preventUnmountOnClose()`, and the content's `onExitComplete` calls
 * `actionsRef.unmount()` — Base UI's close bookkeeping finishes exactly when
 * the exit does, and `onOpenChangeComplete(false)` fires once.
 *
 * A close that arrives as a controlled `open={false}` carries no event to
 * prevent, so Base UI finishes its bookkeeping straight away; the popup
 * stays on screen for the exit because its render element spreads
 * `PRESENT`.
 */
export function useOverlayOpen<
  D extends OpenChangeDetails,
  A extends OverlayActions,
>(props: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: D) => void;
  onOpenChangeComplete?: (open: boolean) => void;
}) {
  const {
    open: openProp,
    defaultOpen = false,
    onOpenChange: onOpenChangeProp,
    onOpenChangeComplete: onOpenChangeCompleteProp,
  } = props;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const reasonRef = useRef<string | undefined>(undefined);
  const actionsRef = useRef<A | null>(null);
  // Whether Base UI still holds the overlay mounted, so the exit's end knows
  // whether an `unmount()` is still owed.
  const mountedRef = useRef(open);

  useEffect(() => {
    if (open) mountedRef.current = true;
  }, [open]);

  const onOpenChange = useCallback(
    (next: boolean, details: D) => {
      onOpenChangeProp?.(next, details);
      if (details.isCanceled) return;
      reasonRef.current = details.reason;
      if (!next) details.preventUnmountOnClose?.();
      setUncontrolled(next);
    },
    [onOpenChangeProp]
  );

  const onOpenChangeComplete = useCallback(
    (next: boolean) => {
      if (!next) mountedRef.current = false;
      onOpenChangeCompleteProp?.(next);
    },
    [onOpenChangeCompleteProp]
  );

  const onExitComplete = useCallback(() => {
    if (mountedRef.current) actionsRef.current?.unmount();
  }, []);

  const presence = useMemo<OverlayPresence>(
    () => ({
      open,
      reason: () => reasonRef.current,
      actionsRef,
      onExitComplete,
    }),
    [open, onExitComplete]
  );

  return {
    rootProps: { open, onOpenChange, onOpenChangeComplete, actionsRef },
    presence,
  };
}

/**
 * Spread on a Base UI part's Motion render element. Base UI marks a popup or
 * backdrop `hidden` once it considers the overlay unmounted; `AnimatePresence`
 * owns the mount here, and a part it still renders is one playing its exit.
 */
export const PRESENT = { hidden: false } as const;

export const OverlayPresenceContext = createContext<OverlayPresence | null>(
  null
);

export function useOverlayPresence(component: string): OverlayPresence {
  const presence = use(OverlayPresenceContext);
  if (!presence) throw new Error(`${component} must sit inside its Root`);
  return presence;
}
