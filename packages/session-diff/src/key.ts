import type { SaveMeta } from "./meta.js";
import { transitionFacet } from "./facet.js";

/** The musical key as one value, so a root or scale change reads as one change. */
export const keyOf = (meta: SaveMeta): string | null => {
  if (!meta.rootNote && !meta.scale) return null;
  return [meta.rootNote, meta.scale].filter(Boolean).join(" ");
};

/** The set's key: its root note and scale together, spelt in the viewer's
 *  key notation. */
export const keyFacet = transitionFacet({
  id: "key",
  kind: "key",
  capability: "key",
  label: "Key",
  noun: "key",
  read: keyOf,
  write: (meta, format) => format.key(meta.rootNote, meta.scale),
});
