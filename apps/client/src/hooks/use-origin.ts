"use client";

import { useSyncExternalStore } from "react";

/** The origin never changes for the life of the document, so there is nothing
 *  to subscribe to. */
const subscribe = () => () => {};

/**
 * The app's own origin, empty on the server. Markup rendered before hydration
 * cannot know it, so anything building an absolute URL reads it here rather
 * than during render, where it would mismatch.
 */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => ""
  );
}
