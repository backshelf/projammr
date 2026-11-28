/**
 * The strips `MeasureStack` can show under the waveform. Which of them show
 * is the visuals policy's `strips`, toggled from a legend of pills rather
 * than per-strip checkboxes buried in a menu.
 */
import {
  STRIP_IDS,
  STRIP_LABELS,
  type StripId,
} from "@workspace/settings/groups/visuals";

export { STRIP_IDS, STRIP_LABELS, type StripId };

/** The plain-language explanation a pill's tooltip shows on hover or keyboard
 *  focus, naming what the strip draws rather than repeating its label. */
export const STRIP_EXPLAINERS: Record<StripId, string> = {
  loudness: "How loud this version is over time, in LUFS",
  spectrogram:
    "Which frequencies sound when, bass at the bottom and treble at the top",
  change: "Where this version differs from the previous one",
};

/** What a page shows before a visitor has chosen anything of their own —
 *  analysis strips stay tucked behind the Analysis disclosure until asked for. */
export const DEFAULT_STRIP_IDS: readonly StripId[] = [];

const isStripId = (value: unknown): value is StripId =>
  typeof value === "string" && (STRIP_IDS as readonly string[]).includes(value);

/**
 * The strips `ids` names that still exist. An unknown id (a strip an older
 * build had, or a hand-edited setting) is dropped rather than crashing the
 * legend. An empty list is a choice to hide every strip and stays empty — but
 * a list of nothing but unknown ids (a retired strip like `sections` or
 * `pitch`) filters down to nothing by accident rather than by choice, so it
 * falls back to {@link DEFAULT_STRIP_IDS} instead of silently hiding every
 * strip.
 */
export function knownStrips(ids: readonly string[]): StripId[] {
  const known = ids.filter(isStripId);
  return known.length > 0 || ids.length === 0 ? known : [...DEFAULT_STRIP_IDS];
}

/** `ids` with `id` present or absent, for a legend pill's own toggle. */
export function toggleStrip(ids: readonly StripId[], id: StripId): StripId[] {
  return ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id];
}
