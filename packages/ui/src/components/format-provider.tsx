"use client";

import {
  defaultFormatters,
  type FormatPrefs,
  type Formatters,
  formattersFor,
  runtimeZone,
} from "@workspace/ui/lib/formatters";
import {
  createContext,
  type ReactNode,
  use,
  useMemo,
  useSyncExternalStore,
} from "react";

/** With no provider above it, a component formats at the defaults in this
 *  runtime's zone: what a page rendered ahead of time, with no viewer, reads. */
const FormatContext = createContext<Formatters>(defaultFormatters());

/** The browser's zone never changes for the life of the document, so there
 *  is nothing to subscribe to. */
const subscribe = () => () => {};

/**
 * Hands the viewer's formatter set to everything below it. `zone` is what
 * the server resolved "auto" to for this request (the zone cookie, else its
 * own zone), and it is what the server's HTML was formatted in, so hydration
 * reads it too and agrees. On the render after hydration "auto" follows the
 * browser's own zone, which differs only before the zone cookie is first
 * written.
 */
export function FormatProvider({
  prefs,
  zone,
  children,
}: {
  prefs: FormatPrefs;
  zone: string;
  children: ReactNode;
}) {
  const browserZone = useSyncExternalStore(subscribe, runtimeZone, () => null);
  const resolved = browserZone ?? zone;
  const format = useMemo(
    () => formattersFor(prefs, resolved),
    [prefs, resolved]
  );
  return <FormatContext value={format}>{children}</FormatContext>;
}

/** The viewer's formatter set. */
export function useFormat(): Formatters {
  return use(FormatContext);
}

/** Hands the viewer's formatter set to `children`, for a render function
 *  that is not a component of its own and so cannot call `useFormat()` (a
 *  table cell, a card field). */
export function Formatted({
  children,
}: {
  children: (format: Formatters) => ReactNode;
}) {
  return children(useFormat());
}
