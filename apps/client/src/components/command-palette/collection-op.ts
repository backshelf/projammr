/**
 * The palette's `add <track>` / `move <track>` verbs: a track is picked, then a
 * collection, then the operation runs. This module is the pure part — what the
 * query means and what steps a resolved operation takes — so the palette only
 * drives the two picks.
 */

export type CollectionOpVerb = "add" | "move";

export type PendingCollectionOp = {
  verb: CollectionOpVerb;
  trackId: number;
  trackTitle: string;
  /** For `move`: the collection the track leaves — the one the page is scoped to. */
  fromCollectionId?: number;
};

export type CollectionOpStep =
  | { kind: "remove"; collectionId: number; trackId: number }
  | { kind: "add"; collectionId: number; trackId: number };

const PREFIXES: { verb: CollectionOpVerb; prefix: string }[] = [
  { verb: "add", prefix: "add " },
  { verb: "move", prefix: "move " },
];

/**
 * Matches the verb at the start of the query. `move` needs somewhere to move
 * from, so it is only recognised when the page is scoped to a collection.
 */
export function matchCollectionOpPrefix(
  query: string,
  { canMove }: { canMove: boolean }
): { verb: CollectionOpVerb; remainder: string } | null {
  const lower = query.toLowerCase();
  for (const { verb, prefix } of PREFIXES) {
    if (verb === "move" && !canMove) continue;
    if (lower.startsWith(prefix)) {
      return { verb, remainder: query.slice(prefix.length).trim() };
    }
  }
  return null;
}

/**
 * The API calls a resolved operation makes, in order, or `null` when there is
 * nothing to do (moving a track to the collection it is already in).
 */
export function planCollectionOp(
  op: PendingCollectionOp,
  targetCollectionId: number
): CollectionOpStep[] | null {
  const add: CollectionOpStep = {
    kind: "add",
    collectionId: targetCollectionId,
    trackId: op.trackId,
  };
  if (op.verb === "add") return [add];
  if (op.fromCollectionId == null || op.fromCollectionId === targetCollectionId)
    return null;
  return [
    { kind: "remove", collectionId: op.fromCollectionId, trackId: op.trackId },
    add,
  ];
}
