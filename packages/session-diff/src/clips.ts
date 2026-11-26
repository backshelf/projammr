import { type Facet, signed } from "./facet.js";

/** The clip kinds a structure counts, with the words each is read in. */
const CLIP_KINDS = [
  { kind: "audio", noun: "audio clip", label: "Audio" },
  { kind: "midi", noun: "midi clip", label: "MIDI" },
] as const;

/**
 * How many audio and MIDI clips the set holds. When either count moves, the
 * readout shows both, so the one that held still gives the other its scale.
 */
export const clipsFacet: Facet = {
  id: "clips",
  capability: "clips",
  compare(before, after) {
    const was = before.structure?.clips;
    const now = after.structure?.clips;
    if (!was || !now) return null;

    const chips = CLIP_KINDS.filter(({ kind }) => now[kind] !== was[kind]).map(
      ({ kind, noun }) => ({
        kind: "clips" as const,
        ...signed(now[kind] - was[kind], noun),
      })
    );
    if (chips.length === 0) return null;

    return {
      chips,
      readout: {
        gauge: "meters",
        label: "Clips",
        meters: CLIP_KINDS.map(({ kind, label }) => ({
          label,
          from: was[kind],
          to: now[kind],
        })),
      },
    };
  },
};
