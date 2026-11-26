/** The explanation each loudness unit abbreviation expands to, shared by the
 *  tooltip (fine pointer) and popover (coarse pointer) `LoudnessUnit` renders. */
export const LOUDNESS_UNIT_COPY = {
  LUFS: "Integrated loudness across the whole track, in loudness units relative to full scale. Streaming services play music at about −14 LUFS.",
  TP: "True peak: the highest level between samples. Keeping it below −1 dB avoids clipping after encoding.",
  M: "Momentary loudness: the level over the last 0.4 seconds, in LUFS. It flicks with every hit, so it reads how a moment lands.",
  S: "Short-term loudness: the level over the last 3 seconds, in LUFS. It rides the passage rather than the beat, so it reads how a section sits.",
} as const;

export type LoudnessUnitKind = keyof typeof LOUDNESS_UNIT_COPY;
