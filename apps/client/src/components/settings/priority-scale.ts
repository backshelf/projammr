import type { PriorityScaleLevel } from "@workspace/api/api";
import { pluralizeCount } from "@workspace/session-diff/format";

/** Up the list (toward the bottom of the scale) or down it. */
export type MoveDirection = -1 | 1;

/** The id of a level's row in the priorities editor. */
export const levelRowId = (levelId: number) => `priority-level-${levelId}`;

/**
 * A write the priorities editor shows before the server answers it: the scale
 * as it reads once the write lands. The server's own scale replaces it when
 * the route re-renders.
 */
export type ScaleChange = (
  levels: readonly PriorityScaleLevel[]
) => PriorityScaleLevel[];

/** The levels in the order `ids` gives; a level it does not name keeps its place after them. */
export const reordered =
  (ids: readonly number[]): ScaleChange =>
  (levels) => {
    const place = new Map(ids.map((id, index) => [id, index]));
    const at = (level: PriorityScaleLevel) => place.get(level.id) ?? ids.length;
    return levels.toSorted((a, b) => at(a) - at(b));
  };

/** The scale with `id` its one default. */
export const withDefault =
  (id: number): ScaleChange =>
  (levels) =>
    levels.map((level) => ({ ...level, isDefault: level.id === id }));

const USAGE_NOUNS = [
  ["tracks", "track"],
  ["collections", "collection"],
  ["sessions", "session"],
] as const;

// The nouns it joins are the app's English copy, so the "and" is English too,
// whatever locale the viewer formats numbers and dates in.
const conjunction = new Intl.ListFormat("en-GB", { type: "conjunction" });

/**
 * The rows holding a level, in words: "3 tracks and 1 session", naming only
 * the kinds that hold it; empty when none do.
 */
export function levelUsage(counts: PriorityScaleLevel["counts"]): {
  total: number;
  words: string;
} {
  const held = USAGE_NOUNS.filter(([kind]) => counts[kind] > 0);
  return {
    total: held.reduce((sum, [kind]) => sum + counts[kind], 0),
    words: conjunction.format(
      held.map(([kind, noun]) => pluralizeCount(counts[kind], noun))
    ),
  };
}

/**
 * The level that takes a deleted level's rows unless another is picked: the
 * default, or the first other level when the deleted one is the default.
 */
export function fallbackLevel(
  levels: readonly PriorityScaleLevel[],
  level: PriorityScaleLevel
): PriorityScaleLevel | undefined {
  const others = levels.filter((other) => other.id !== level.id);
  return others.find((other) => other.isDefault) ?? others[0];
}

/** What deleting a level would move: "3 tracks and 1 session use “High”." */
export function usageSentence(level: PriorityScaleLevel): string {
  const { total, words } = levelUsage(level.counts);
  if (total === 0) {
    return `No tracks, collections or sessions use “${level.name}”.`;
  }
  return `${words} ${total === 1 ? "uses" : "use"} “${level.name}”.`;
}
