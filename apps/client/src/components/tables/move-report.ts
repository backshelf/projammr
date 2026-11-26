import type { PriorityFallback } from "@workspace/api/api";
import { pluralizeCount } from "@workspace/session-diff/format";

/**
 * What a move's report says about priority, as the mover reads it once the
 * move is done: each level the destination had no level of that name for, the
 * destination's default the rows took instead, and how many rows (tracks,
 * collections and sessions together) did. Nothing when every level carried
 * over.
 */
export function priorityFallbackNote(
  fallbacks: readonly PriorityFallback[] = []
): string | undefined {
  if (fallbacks.length === 0) return undefined;
  const lines = fallbacks.map(
    ({ from, to, count }) =>
      `${from} became ${to} on ${pluralizeCount(count, "row")}`
  );
  return `${lines.join(", ")}.`;
}
