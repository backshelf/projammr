import { tempoRuler } from "./ruler.js";
import type { Facet } from "./facet.js";

/**
 * The set's tempo. Compared as a number, so "126" and "126.0" read as the
 * same tempo, while the chip still writes the figures the way a producer
 * says them, rounded as the viewer's tempo preference says.
 */
export const tempoFacet: Facet = {
  id: "tempo",
  capability: "tempo",
  compare(before, after, format) {
    if (after.tempo == null) return null;
    const to = Number(after.tempo);
    const from = before.tempo == null ? null : Number(before.tempo);
    if (from === to) return null;

    const fromText = from == null ? "—" : format.tempo(from);
    const toText = format.tempo(to);
    return {
      chips: [
        {
          kind: "tempo",
          label: `tempo ${fromText} → ${toText}`,
          from: fromText,
          to: toText,
        },
      ],
      readout: {
        gauge: "ruler",
        label: "Tempo",
        ruler: tempoRuler(format),
        from,
        to,
      },
    };
  },
};
