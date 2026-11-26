import { transitionFacet } from "./facet.js";

/**
 * The DAW version the set was saved in, as the DAW names itself ("Ableton
 * Live 12.3"). A move marks the first save in a newer version, which an older
 * one may no longer open.
 */
export const dawVersionFacet = transitionFacet({
  id: "dawVersion",
  kind: "dawVersion",
  capability: "dawVersion",
  label: "DAW version",
  noun: null,
  read: (meta) => meta.dawVersion,
});
