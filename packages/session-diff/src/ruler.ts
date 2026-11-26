import type { DiffFormat } from "./format.js";

export type RulerMark = { value: number; label: string };

export type RulerConfig = {
  /** The ruler's left and right ends. */
  min: number;
  max: number;
  /** Where the numbered ticks land, in the same units as `min`/`max`. */
  stops: readonly number[];
  /** A dotted hairline at a value the domain treats specially (loudness's
   *  reference level); absent where there is none. */
  reference?: number;
  /** The reference hairline's tooltip and the title on its own numeral. */
  referenceTitle?: string;
  /** A stop's numeral, e.g. loudness's `−14`. */
  format: (value: number) => string;
  /** A mark's own tooltip figure. A mark is a measurement, not one of the
   *  ruler's fixed stops, so a domain that wants more precision there than
   *  `format` gives its whole-number stops (loudness's one decimal) sets
   *  this; it falls back to `format` for a domain where the two agree
   *  (tempo's whole BPM). */
  formatMark?: (value: number) => string;
  /** Appended to a mark's tooltip figure ("LUFS", "BPM"); omitted where the
   *  value speaks for itself. */
  unit?: string;
};

/** 60–200 BPM covers a ballad to a drum'n'bass track: the tempo domain's
 *  preset, the way `loudnessRuler` is loudness's. Its stops are whole
 *  numerals; a mark is a tempo, written as the viewer's `format` writes one. */
export function tempoRuler(format: DiffFormat): RulerConfig {
  return {
    min: 60,
    max: 200,
    stops: [60, 100, 140, 180],
    unit: "BPM",
    format: (bpm) => format.number(Math.round(bpm)),
    formatMark: (bpm) => format.tempo(bpm, { unit: false, whole: true }),
  };
}
