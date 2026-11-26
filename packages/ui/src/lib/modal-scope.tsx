"use client";

import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createContext,
  use,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";

/** What a dialog's modal push attaches: what its confirm key runs, if it has
 *  one thing to confirm. */
export type ModalSurface = { confirm?: () => void };

/** Pushes `surface`, attaching it to the modal scope; the returned function
 *  releases the push. */
export type ModalScopePusher = (surface: ModalSurface) => () => void;

const ModalScopeContext = createContext<ModalScopePusher | null>(null);

/**
 * Fills the seam a dialog primitive pushes the modal command scope through.
 * `packages/ui` cannot import the client's command registry, so the client
 * renders this with a pusher onto its own registry; `useModalScope` does
 * nothing without one (signed-out pages, the dit app and `apps/web` render ui
 * dialogs with no provider).
 */
export function ModalScopeProvider({
  push,
  children,
}: {
  push: ModalScopePusher;
  children: ReactNode;
}) {
  return <ModalScopeContext value={push}>{children}</ModalScopeContext>;
}

const NO_SURFACE: ModalSurface = {};

/**
 * Pushes the modal scope while `open`, releasing on close or unmount. Reads
 * `surface` through a latest ref, so a new `confirm` closure every render
 * does not re-push.
 *
 * The push is a layout effect so it lands before any passive-effect push the
 * overlay's own content makes (a list's key scope): a child's passive effect
 * would otherwise run first and the modal push above it would silence it.
 */
export function useModalScope(
  open: boolean,
  surface: ModalSurface = NO_SURFACE
) {
  const push = use(ModalScopeContext);
  const surfaceRef = useLatestRef(surface);

  const stableSurface = useMemo<ModalSurface>(
    () => ({
      get confirm() {
        return surfaceRef.current.confirm;
      },
    }),
    [surfaceRef]
  );

  useLayoutEffect(() => {
    if (!push || !open) return;
    return push(stableSurface);
  }, [push, open, stableSurface]);
}
