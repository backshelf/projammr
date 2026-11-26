/**
 * What the sidebar lists, and the palette beside it: the recently edited
 * slices and the order of a project's collections, each as the shell policy
 * says.
 */

import type { CollectionOrder, ShellPolicy } from "@/lib/policies/shell";
import { collectionSorter } from "@/lib/utils";

type RecentsPolicy = Pick<ShellPolicy, "recentItems" | "recentsSkipArchived">;

const first = <T>(items: T[], policy: RecentsPolicy): T[] =>
  items.slice(0, Math.max(0, policy.recentItems));

/**
 * The most recently edited tracks, in the server's newest-first order. While
 * the policy skips archived tracks they are left out before the count is
 * taken, so they never use up a place.
 */
export function recentTracks<T extends { archivedAt: string | null }>(
  tracks: readonly T[],
  policy: RecentsPolicy
): T[] {
  return first(
    tracks.filter(
      (track) => !policy.recentsSkipArchived || track.archivedAt === null
    ),
    policy
  );
}

/** The most recently edited sessions, those of archived tracks skipped as
 *  archived tracks are. */
export function recentSessions<T extends { archived: boolean }>(
  sessions: readonly T[],
  policy: RecentsPolicy
): T[] {
  return first(
    sessions.filter(
      (session) => !policy.recentsSkipArchived || !session.archived
    ),
    policy
  );
}

/**
 * The most recently edited notes. The list endpoint puts pinned notes first;
 * a recents list wants the newest whether pinned or not.
 */
export function recentNotes<T extends { updatedAt: string }>(
  notes: readonly T[],
  policy: RecentsPolicy
): T[] {
  return first(
    [...notes].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    ),
    policy
  );
}

type OrderedCollection = {
  title: string;
  releaseDate: string | null;
  updatedAt: string;
};

const COLLECTION_ORDERS: Record<
  CollectionOrder,
  (a: OrderedCollection, b: OrderedCollection) => number
> = {
  release: collectionSorter,
  title: (a, b) => a.title.localeCompare(b.title),
  edited: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
};

/** A project's collections in the order the sidebar lists them. */
export function orderCollections<T extends OrderedCollection>(
  collections: readonly T[],
  order: CollectionOrder
): T[] {
  return [...collections].sort(COLLECTION_ORDERS[order]);
}
