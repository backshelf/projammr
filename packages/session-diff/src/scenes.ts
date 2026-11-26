import { type Facet, signed } from "./facet.js";

/** How many scenes the set's clip launcher holds, for a DAW that has one. */
export const scenesFacet: Facet = {
  id: "scenes",
  capability: "scenes",
  compare(before, after) {
    const was = before.scenesCount;
    const now = after.scenesCount;
    if (was == null || now == null || was === now) return null;

    return {
      chips: [{ kind: "scenes", ...signed(now - was, "scene") }],
      readout: {
        gauge: "transition",
        label: "Scenes",
        from: String(was),
        to: String(now),
      },
    };
  },
};
