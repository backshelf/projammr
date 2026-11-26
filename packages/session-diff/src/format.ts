import { type KeyNotation, spellKey } from "./musical-key.js";

/** "3 tracks", "1 track". */
export const pluralizeCount = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

export type TempoOptions = {
  /**
   * Whether "BPM" follows the figure: `true` where a sentence needs the unit
   * to make sense, `false` where something beside it adds the unit already
   * (a ruler's tooltip). Absent, the figure sits under a label that names
   * the unit and the viewer's preference decides.
   */
  unit?: boolean;
  /**
   * A figure with no written form of its own to keep, such as a statistic
   * or a detected tempo on a chart: where the preference keeps tempos as
   * written, this one reads as a whole BPM.
   */
  whole?: boolean;
};

export type TempoRounding = "raw" | "integer" | "one-decimal";

/** The three ways a diff writes a figure: the viewer's `Formatters` satisfy
 *  this shape, and {@link diffFormat} builds one for a caller with no viewer. */
export type DiffFormat = {
  /** A count in the locale's grouping: "1,234". */
  number: (value: number) => string;
  /** A tempo, rounded as the preference says: "128", "128 BPM". */
  tempo: (bpm: number | string, options?: TempoOptions) => string;
  /** A key from its tonic and scale in the preferred notation; null with neither. */
  key: (
    tonic: string | null | undefined,
    scale: string | null | undefined
  ) => string | null;
};

export type TempoPrefs = {
  /** "raw" keeps a tempo as it was written (92.35); the others round it. */
  rounding: TempoRounding;
  /** Write "BPM" after a tempo that sits under a label already naming it. */
  suffix: boolean;
};

export type DiffFormatPrefs = {
  locale?: string;
  keyNotation?: KeyNotation;
  tempo?: TempoPrefs;
};

/** The preferences every surface is written in until a viewer picks their own. */
export const DIFF_FORMAT_DEFAULTS: Required<DiffFormatPrefs> = {
  locale: "en-GB",
  keyNotation: "sharps",
  tempo: { rounding: "raw", suffix: false },
};

/**
 * Puts the locale's decimal sign in a figure already written with a ".": the
 * digits stay as they were rounded, so the default output cannot drift on how
 * `Intl` rounds a half.
 */
export function localDecimalPoint(locale: string): (figure: string) => string {
  const point =
    new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return (figure) => (point === "." ? figure : figure.replace(".", point));
}

/** {@link DIFF_FORMAT_DEFAULTS} unless the caller says otherwise. */
export function diffFormat(prefs: DiffFormatPrefs = {}): DiffFormat {
  const {
    locale = DIFF_FORMAT_DEFAULTS.locale,
    keyNotation = DIFF_FORMAT_DEFAULTS.keyNotation,
    tempo = DIFF_FORMAT_DEFAULTS.tempo,
  } = prefs;
  const numbers = new Intl.NumberFormat(locale);
  const wholes = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  const tenths = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  const localPoint = localDecimalPoint(locale);

  const figure = (bpm: number, whole: boolean) => {
    const rounding =
      tempo.rounding === "raw" && whole ? "integer" : tempo.rounding;
    if (rounding === "integer") return wholes.format(Math.round(bpm));
    if (rounding === "one-decimal") return tenths.format(bpm);
    return localPoint(String(bpm));
  };

  return {
    number: (value) => numbers.format(value),
    tempo(bpm, { unit, whole = false }: TempoOptions = {}) {
      const value = Number(bpm);
      const text = Number.isFinite(value) ? figure(value, whole) : String(bpm);
      return (unit ?? tempo.suffix) ? `${text} BPM` : text;
    },
    key: (tonic, scale) => spellKey(tonic, scale, keyNotation),
  };
}

let defaults: DiffFormat | undefined;

/** {@link diffFormat} at its defaults: what a diff with no viewer behind it writes in. */
export function defaultDiffFormat(): DiffFormat {
  return (defaults ??= diffFormat());
}
