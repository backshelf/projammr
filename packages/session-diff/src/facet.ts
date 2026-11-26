import type { SaveMeta } from "./meta.js";
import { pluralizeCount } from "./format.js";
import type { DiffFormat } from "./format.js";
import type { RulerConfig } from "./ruler.js";

export type DiffChipKind =
  | "first"
  | "tempo"
  | "timeSignature"
  | "key"
  | "tracks"
  | "rename"
  | "devices"
  | "clips"
  | "scenes"
  | "samples"
  | "dawVersion";

/** One worded change between two saves, ready to render as it stands. */
export type DiffChip = {
  kind: DiffChipKind;
  /** The whole chip as text, unchanged for the feed. */
  label: string;
  /** Set on a +/− chip. */
  sign?: "add" | "remove";
  /** Set on a scalar or rename chip, so a renderer can style the two halves apart. */
  from?: string;
  to?: string;
};

/** How the save diff card draws a value that moved: the gauge it sits on and what it reads. */
export type Readout = { label: string } & (
  | {
      /** A figure on a ruler, the caret moving from the old value to the new. */
      gauge: "ruler";
      ruler: RulerConfig;
      from: number | null;
      to: number;
    }
  | {
      /** Counts drawn as meters, the part a save added or took away marked on each. */
      gauge: "meters";
      meters: { label: string; from: number; to: number }[];
    }
  | {
      /** A value that has no scale to sit on, read as `from → to`. */
      gauge: "transition";
      from: string | null;
      to: string;
    }
);

/** What one facet found changed between two saves. */
export type FacetChange = {
  chips: DiffChip[];
  /** Absent for a facet the card draws in a part of its own (the outline, the samples). */
  readout?: Readout;
};

/**
 * One thing a save can change, and everything about it: the DAW capability
 * without which there is nothing to read, and how two saves compare on it,
 * already worded for a save's feed row and set up for the card's gauge. A DAW
 * that reports something new is one more facet, and nothing that renders
 * facets needs to know which one it holds.
 */
export interface Facet {
  readonly id: string;
  readonly capability: string;
  /** What changed between two saves, or null when nothing this facet reads
   *  did, worded in the viewer's `format`. */
  compare(
    before: SaveMeta,
    after: SaveMeta,
    format: DiffFormat
  ): FacetChange | null;
}

export const MINUS = "−";

/** A worded `+n noun`/`−n noun` chip half, with the direction it reads as. */
export const signed = (
  n: number,
  noun: string
): { label: string; sign: "add" | "remove" } =>
  n > 0
    ? { label: `+${pluralizeCount(n, noun)}`, sign: "add" }
    : { label: `${MINUS}${pluralizeCount(-n, noun)}`, sign: "remove" };

/**
 * A facet over one value a save carries as text (a time signature, a key, a
 * version): when the newer save has one and it differs, the change is a
 * `from → to` chip, prefixed by `noun` where the value needs naming, and a
 * transition readout. `write` words a value for the viewer where it has more
 * than one spelling (a key); the comparison is always on what was read.
 */
export function transitionFacet(spec: {
  id: string;
  kind: DiffChipKind;
  capability: string;
  /** The readout's label. */
  label: string;
  /** What the chip calls the value ("time sig"); null where the value names itself. */
  noun: string | null;
  read: (meta: SaveMeta) => string | null | undefined;
  write?: (meta: SaveMeta, format: DiffFormat) => string | null;
}): Facet {
  return {
    id: spec.id,
    capability: spec.capability,
    compare(before, after, format) {
      const read = spec.read(after) ?? null;
      if (read == null || (spec.read(before) ?? null) === read) return null;

      const written = (meta: SaveMeta) =>
        (spec.write ? spec.write(meta, format) : spec.read(meta)) ?? null;
      const was = written(before);
      const now = written(after) ?? read;
      const from = was ?? "—";
      const text = `${from} → ${now}`;
      return {
        chips: [
          {
            kind: spec.kind,
            label: spec.noun ? `${spec.noun} ${text}` : text,
            from,
            to: now,
          },
        ],
        readout: { gauge: "transition", label: spec.label, from: was, to: now },
      };
    },
  };
}
