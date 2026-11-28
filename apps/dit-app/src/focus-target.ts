import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  type RefCallback,
} from "react";

import { onFocus } from "./bridge";

export type FocusController = {
  claim: RefCallback<HTMLElement>;
  focusCurrent: (fallback?: HTMLElement | null) => void;
};

/**
 * Moves focus to one element each time the panel's window takes key focus, so the panel opens ready to type into.
 * Returns the ref callback a screen puts on the field it wants focus in (`useFocusTarget` hands it out) and a helper
 * to transfer focus on screen transitions; with no field claimed, focus moves to `fallback` or stays where it is.
 */
export function useFocusController(): FocusController {
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stop = onFocus(() => targetRef.current?.focus());
    return () => {
      void stop.then((off) => off());
    };
  }, []);

  const claim = useCallback((element: HTMLElement | null) => {
    targetRef.current = element;
    return () => {
      if (targetRef.current === element) targetRef.current = null;
    };
  }, []);

  const focusCurrent = useCallback((fallback?: HTMLElement | null) => {
    if (targetRef.current) {
      targetRef.current.focus();
    } else {
      fallback?.focus();
    }
  }, []);

  return { claim, focusCurrent };
}

/** Backwards-compatible wrapper returning the claim callback alone. */
export function useFocusOnShow(): RefCallback<HTMLElement> {
  return useFocusController().claim;
}

const FocusTargetContext = createContext<RefCallback<HTMLElement> | null>(null);

/** Provides the claim `useFocusOnShow` returned to every screen below it. */
export const FocusTargetProvider = FocusTargetContext.Provider;

/** A ref for the field this screen wants focus in when the panel is shown. */
export function useFocusTarget(): RefCallback<HTMLElement> {
  const claim = use(FocusTargetContext);
  if (!claim) throw new Error("FocusTargetProvider is missing.");
  return claim;
}
