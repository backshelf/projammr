"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Custom-scheme navigation fails silently when no handler is registered. There
// is no reliable success signal, so we assume failure unless the tab loses
// focus shortly after the jump.
const HANDLER_GRACE_MS = 1200;

export function useDeepLink(): {
  /** Fires the href and starts the "did the app answer" window. */
  open: (href: string) => void;
  fallbackOpen: boolean;
  setFallbackOpen: (open: boolean) => void;
} {
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const open = useCallback((href: string) => {
    cleanupRef.current?.();

    let handled = false;
    const onBlur = () => {
      handled = true;
    };
    const onVisibility = () => {
      if (document.hidden) handled = true;
    };
    window.addEventListener("blur", onBlur, { once: true });
    document.addEventListener("visibilitychange", onVisibility, { once: true });

    const timer = setTimeout(() => {
      cleanupRef.current = null;
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (!handled && document.hasFocus()) {
        setFallbackOpen(true);
      }
    }, HANDLER_GRACE_MS);

    cleanupRef.current = () => {
      clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupRef.current = null;
    };

    window.location.href = href;
  }, []);

  return { open, fallbackOpen, setFallbackOpen };
}
