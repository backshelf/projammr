import { RulerScale } from "@workspace/ui/components/loudness/ruler-scale";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { formatLufs } from "@workspace/ui/lib/loudness";
import type { RulerConfig } from "@workspace/session-diff/ruler";
import type { ReactNode } from "react";

/** The loudness ruler's ends, in LUFS. */
export const LOUDNESS_FLOOR = -28;
export const LOUDNESS_CEILING = 0;

/** How many numbered stops the ruler carries, evenly spaced end to end. */
const STOP_COUNT = 5;

/** A whole-LUFS numeral with a typographic minus. */
const wholeLufs = (lufs: number) => (lufs === 0 ? "0" : `−${-lufs}`);

/**
 * The loudness ruler: −28 to 0 LUFS in five numerals 7 LU apart, with a
 * dotted reference hairline at `reference` LUFS, the level the viewer
 * measures masters against (quieter ones fall left of it, louder ones
 * right). A mark is a measured reading rather than one of the fixed stops,
 * so its own tooltip keeps `formatLufs`'s one decimal instead of the stops'
 * whole numeral.
 */
export function loudnessRuler(reference: number): RulerConfig {
  const span = LOUDNESS_CEILING - LOUDNESS_FLOOR;
  return {
    min: LOUDNESS_FLOOR,
    max: LOUDNESS_CEILING,
    stops: Array.from(
      { length: STOP_COUNT },
      (_, i) => LOUDNESS_FLOOR + (span * i) / (STOP_COUNT - 1)
    ),
    reference,
    referenceTitle: `Loudness reference: ${wholeLufs(reference)} LUFS`,
    unit: "LUFS",
    format: wholeLufs,
    formatMark: formatLufs,
  };
}

export type LoudnessMark = {
  lufs: number;
  /** Names the mark in its tooltip: a track title, a version. */
  label: string;
};

/**
 * Integrated loudness laid out on a ruler — the {@link RulerScale} preset for
 * the loudness domain. `CollectionLoudness` puts every track on the scale
 * with the median under the caret; `TrackLoudness` puts every version on it
 * with the caret on the version the masthead is showing. No `--warn`: a loud
 * master is a fact, not a fault. A mark's tooltip figure is written in the
 * viewer's `format` (the defaults for a page with no viewer).
 */
export function LoudnessScale({
  marks,
  reference,
  band,
  pointer,
  label,
  live,
  tone = "paper",
  className,
  format,
}: {
  marks: LoudnessMark[];
  /** Where the dotted reference hairline sits, in LUFS. */
  reference: number;
  /** Quietest and loudest values, drawn as a bar between them. */
  band?: [number, number];
  /** The value the caret points at. */
  pointer?: number;
  /** What a screen reader hears in place of the drawing. */
  label: string;
  live?: ReactNode;
  /** `art` when the scale sits over an artwork field rather than paper. */
  tone?: "paper" | "art";
  className?: string;
  format?: Formatters;
}) {
  const ruler = loudnessRuler(reference);
  return (
    <RulerScale
      config={format ? { ...ruler, formatMark: format.lufs } : ruler}
      marks={marks.map((mark) => ({ value: mark.lufs, label: mark.label }))}
      band={band}
      pointer={pointer}
      label={label}
      live={live}
      tone={tone}
      className={className}
    />
  );
}
