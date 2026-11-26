"use client";

import { COMPOSE_SCOPE } from "@/components/commands/comments";
import {
  useCommandScope,
  useInCommandRegistry,
} from "@/components/commands/provider";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

/**
 * A comment composer's send key. Inside the signed-in app the compose scope
 * is pushed while focus is anywhere in the composer, so `mod+Enter` (or
 * whatever it is bound to) sends through the command registry. A share page
 * has no registry, so there the composer answers `mod+Enter` itself.
 *
 * Spread `focusProps` on the composer's root and `onKeyDown` on its textarea.
 * `send` is read through a latest ref, so a new closure every render is fine.
 */
export function useComposeKey(send: () => void, enabled = true) {
  const inRegistry = useInCommandRegistry();
  const [focused, setFocused] = useState(false);
  const sendRef = useLatestRef(send);

  const surface = useMemo(() => ({ send: () => sendRef.current() }), [sendRef]);
  useCommandScope(COMPOSE_SCOPE, surface, enabled && focused);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setFocused(false);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendRef.current();
    },
    [sendRef]
  );

  return {
    focusProps: { onFocus, onBlur },
    onKeyDown: inRegistry ? undefined : onKeyDown,
  };
}
