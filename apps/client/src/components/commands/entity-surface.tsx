"use client";

import {
  ENTITY_SCOPE,
  type EntityKeyName,
  type EntitySurface,
} from "@/components/commands/entity";
import {
  useCommandScope,
  useNotifyCommands,
} from "@/components/commands/provider";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";

type Handlers = {
  register: (name: EntityKeyName, fn: () => void) => () => void;
  get: EntitySurface["handler"];
};

const HandlersContext = createContext<Handlers | null>(null);

/**
 * Pushes the entity scope while a track page is mounted, and lets the
 * controls under it register the handlers its keys run (`useEntityKey`).
 * Takes serialisable props only, so a server page renders it directly.
 */
export function EntitySurfaceProvider({
  previousHref,
  nextHref,
  children,
}: {
  previousHref: string | null;
  nextHref: string | null;
  children: ReactNode;
}) {
  const registeredRef = useRef(new Map<EntityKeyName, () => void>());
  // A key's availability reads the handler map, so the registry re-reads it
  // (the bar, the overlay) whenever a handler comes or goes.
  const notify = useNotifyCommands();

  const handlers = useMemo<Handlers>(
    () => ({
      register: (name, fn) => {
        registeredRef.current.set(name, fn);
        notify();
        return () => {
          if (registeredRef.current.get(name) !== fn) return;
          registeredRef.current.delete(name);
          notify();
        };
      },
      get: (name) => registeredRef.current.get(name),
    }),
    [notify]
  );

  const surface = useMemo<EntitySurface>(
    () => ({ previousHref, nextHref, handler: handlers.get }),
    [previousHref, nextHref, handlers]
  );
  useCommandScope(ENTITY_SCOPE, surface, true);

  return <HandlersContext value={handlers}>{children}</HandlersContext>;
}

/**
 * Registers `fn` as what the entity page's `name` key runs, for as long as the
 * calling control is mounted. A no-op where no `EntitySurfaceProvider` is
 * above (a share page renders the same controls). `fn` is read through a
 * latest ref, so a new closure every render is fine. While `enabled` is false
 * nothing is registered, so the key is absent rather than a no-op.
 */
export function useEntityKey(
  name: EntityKeyName,
  fn: () => void,
  enabled = true
) {
  const handlers = use(HandlersContext);
  const fnRef = useLatestRef(fn);

  useEffect(
    () =>
      enabled ? handlers?.register(name, () => fnRef.current()) : undefined,
    [handlers, name, fnRef, enabled]
  );
}
