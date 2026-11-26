/**
 * The tonic and mode behind a key string, for anything that needs the two
 * apart: adopting a detected key onto a session's `rootNote`/`scale`, or
 * placing a track on the circle of fifths.
 *
 * Two writers spell the same key differently — the estimator's
 * `@workspace/dsp/offline` format is `F♯ minor`, a session's own key is its
 * `rootNote` and `scale` joined (`C# Major`) — so both are read, and the
 * tonic comes back in the `♯` spelling the circle's tables are written in.
 */

export type ParsedKey = { tonic: string; scale: "major" | "minor" };

/** A key string's two halves exactly as written: the tonic is its first
 *  word, the scale everything after it. */
export function keyParts(musicalKey: string): {
  tonic: string | null;
  scale: string | null;
} {
  const [tonic, ...scale] = musicalKey.trim().split(/\s+/);
  return { tonic: tonic || null, scale: scale.join(" ") || null };
}

/** A tonic and a mode as the circle reads them, or null for a mode other
 *  than major or minor. */
function keyFromParts(tonic: string, mode: string): ParsedKey | null {
  const scale = mode.toLowerCase();
  if (!tonic || (scale !== "major" && scale !== "minor")) return null;
  return { tonic: tonic.replace("#", "♯"), scale };
}

export function parseMusicalKey(musicalKey: string): ParsedKey | null {
  const [tonic, mode] = musicalKey.split(" ");
  return tonic && mode ? keyFromParts(tonic, mode) : null;
}

/**
 * The twelve major keys around the circle of fifths, starting at C and going
 * clockwise by the interval a fifth up. Each major key's relative minor
 * shares its position on the inner ring.
 */
export const CIRCLE_OF_FIFTHS_MAJORS = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F♯",
  "C♯",
  "G♯",
  "D♯",
  "A♯",
  "F",
] as const;

/** Each major key's relative minor tonic, index-matched to
 *  {@link CIRCLE_OF_FIFTHS_MAJORS}. */
const RELATIVE_MINORS = [
  "A",
  "E",
  "B",
  "F♯",
  "C♯",
  "G♯",
  "D♯",
  "A♯",
  "F",
  "C",
  "G",
  "D",
] as const;

/** A key's position on the circle: which of the twelve spokes it sits on,
 *  and whether it belongs on the inner (minor) or outer (major) ring. Null
 *  for a tonic the circle does not know, major or minor alike — every writer
 *  spells one of the twelve, so this only guards a hand-built key. */
export function circleOfFifthsPosition(
  key: ParsedKey
): { index: number; ring: "outer" | "inner" } | null {
  if (key.scale === "major") {
    const index = CIRCLE_OF_FIFTHS_MAJORS.indexOf(
      key.tonic as (typeof CIRCLE_OF_FIFTHS_MAJORS)[number]
    );
    return index === -1 ? null : { index, ring: "outer" };
  }
  const index = RELATIVE_MINORS.indexOf(
    key.tonic as (typeof RELATIVE_MINORS)[number]
  );
  return index === -1 ? null : { index, ring: "inner" };
}

/** How a key is written: sharps and flats name the tonic, Camelot and Open
 *  Key number its place on the circle of fifths. */
export type KeyNotation = "sharps" | "flats" | "camelot" | "openkey";

/** Each sharp tonic's flat name. C, F and the other naturals have none. */
const FLAT_NAMES: Readonly<Record<string, string>> = {
  "C♯": "D♭",
  "D♯": "E♭",
  "F♯": "G♭",
  "G♯": "A♭",
  "A♯": "B♭",
};

const written = (tonic: string, scale: string | null) =>
  scale ? `${tonic} ${scale}` : tonic;

const flatName = (tonic: string) =>
  FLAT_NAMES[tonic.replace("#", "♯")] ?? tonic;

/** One notation: how it writes a whole key, and how it labels a spoke of
 *  the major ring. */
type Spelling = {
  key(tonic: string, scale: string | null): string;
  spoke(index: number): string;
};

/** A notation that numbers the circle: a key with a position reads as its
 *  wheel label, any other (a mode the circle does not carry, a tonic with
 *  no scale) keeps the plain spelling rather than a wrong number. */
const wheel = (label: (index: number, ring: "outer" | "inner") => string) =>
  ({
    key(tonic, scale) {
      const parsed = scale ? keyFromParts(tonic, scale) : null;
      const position = parsed && circleOfFifthsPosition(parsed);
      return position
        ? label(position.index, position.ring)
        : written(tonic, scale);
    },
    spoke: (index) => label(index, "outer"),
  }) satisfies Spelling;

const SPELLINGS: Readonly<Record<KeyNotation, Spelling>> = {
  sharps: {
    key: written,
    spoke: (index) => CIRCLE_OF_FIFTHS_MAJORS[index] ?? "",
  },
  flats: {
    key: (tonic, scale) => written(flatName(tonic), scale),
    spoke: (index) => flatName(CIRCLE_OF_FIFTHS_MAJORS[index] ?? ""),
  },
  // The Camelot wheel puts C major at 8B and counts up a fifth at a time;
  // a minor key is the A beside its relative major's B.
  camelot: wheel(
    (index, ring) => `${((index + 7) % 12) + 1}${ring === "outer" ? "B" : "A"}`
  ),
  // Open Key puts C major at 1d (dur) and A minor at 1m (moll).
  openkey: wheel(
    (index, ring) => `${index + 1}${ring === "outer" ? "d" : "m"}`
  ),
};

/**
 * A key written in `notation` from its two halves, or null when it has
 * neither. Sharps is the key as written (`C# Major`, `F♯ minor`); flats
 * renames a sharp tonic (`D♭ Major`) and leaves a natural alone; Camelot
 * (`3B`) and Open Key (`8d`) number a major or minor key's place on the
 * circle and write any other key as sharps does.
 */
export function spellKey(
  tonic: string | null | undefined,
  scale: string | null | undefined,
  notation: KeyNotation
): string | null {
  if (!tonic) return scale || null;
  return SPELLINGS[notation].key(tonic, scale || null);
}

/** The label of spoke `index` on the major ring, in `notation`: the tonic
 *  for sharps and flats, the major key's number for Camelot and Open Key. */
export function spokeLabel(index: number, notation: KeyNotation): string {
  return SPELLINGS[notation].spoke(index);
}
