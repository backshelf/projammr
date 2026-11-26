import { diffSaves, type DiffChip } from "@workspace/session-diff";

import type { SaveRow, SetMeta } from "../ipc";

/**
 * What each save changed, newest first: a save is read against the next older one that could be read, and the
 * oldest against the commit's own save (the first save of a set with no commit has nothing before it and says so).
 * A save the app could not read has no chips. Every capability is claimed: dit stores none, and an empty list means
 * the DAW claims everything.
 */
export function chipsOf(
  saves: readonly SaveRow[],
  head: SetMeta | null
): DiffChip[][] {
  return saves.map((save, index) => {
    if (save.meta === null) return [];
    const older = saves.slice(index + 1).find((entry) => entry.meta !== null);
    return diffSaves(older?.meta ?? head, save.meta, []);
  });
}
