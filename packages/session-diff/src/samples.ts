import type { SaveMeta } from "./meta.js";
import { type DiffChip, type Facet, signed } from "./facet.js";

/** The sample files one save imports that the other does not. */
export type SampleDelta = { added: string[]; removed: string[] };

export const NO_SAMPLE_CHANGE: SampleDelta = { added: [], removed: [] };

export function sampleDelta(before: SaveMeta, after: SaveMeta): SampleDelta {
  const was = new Set(before.samplePaths ?? []);
  const now = new Set(after.samplePaths ?? []);
  return {
    added: [...now].filter((path) => !was.has(path)),
    removed: [...was].filter((path) => !now.has(path)),
  };
}

/** The samples the set imports. The card lists them in a part of its own. */
export const samplesFacet: Facet = {
  id: "samples",
  capability: "samplePaths",
  compare(before, after) {
    const { added, removed } = sampleDelta(before, after);
    const chips: DiffChip[] = [];
    if (added.length > 0) {
      chips.push({ kind: "samples", ...signed(added.length, "sample") });
    }
    if (removed.length > 0) {
      chips.push({ kind: "samples", ...signed(-removed.length, "sample") });
    }
    return chips.length > 0 ? { chips } : null;
  },
};
