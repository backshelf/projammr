import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  type RefCallback,
} from "react";

import { onFocus } from "./bridge";

/**
 * Moves focus to one element each time the panel's window takes key focus, so the panel opens ready to type into.
 * Returns the ref callback a screen puts on the field it wants focus in (`useFocusTarget` hands it out); with no
 * field claimed, focus is left where it is.
 */
export function useFocusOnShow(): RefCallback<HTMLElement> {
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stop = onFocus(() => targetRef.current?.focus());
    return () => {
      void stop.then((off) => off());
    };
  }, []);

  return useCallback((element: HTMLElement | null) => {
    targetRef.current = element;
    return () => {
      if (targetRef.current === element) targetRef.current = null;
    };
  }, []);
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
