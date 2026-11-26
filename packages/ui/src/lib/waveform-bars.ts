/** The most bars a wave ever draws, and the grid the strips under it share. */
export const MAX_BARS = 160;

/** The pixels a bar takes by default: 2px of bar and a 2px gap. */
export const BAR_PITCH = 4;

/** The count `width` holds at `pitch` pixels a bar, between 24 and {@link MAX_BARS}. */
export const barCountFor = (width: number, pitch: number = BAR_PITCH) =>
  Math.max(24, Math.min(MAX_BARS, Math.floor(width / pitch)));

/**
 * The bar a moment lands on, on a grid of `count` bars spanning
 * `durationSeconds`: a section boundary, a clip bin, a comment — anything a
 * strip under the waveform places on its timeline. Bars are the wave's own
 * bucketing (`toBars`' `start`), named for reuse rather than re-derived per
 * caller. Clamped to the grid, and `-1` for a non-finite duration, since
 * there is no timeline to place anything on.
 */
export function bucketOf(
  seconds: number,
  durationSeconds: number,
  count: number = MAX_BARS
): number {
  if (!(durationSeconds > 0) || count <= 0) return -1;
  return Math.max(
    0,
    Math.min(count - 1, Math.floor((seconds / durationSeconds) * count))
  );
}

/** The loudest peak across every series, as the ceiling two waves share so
 *  their heights stay comparable. A quiet recording fills the wave to the
 *  top rather than drawing nearly flat against a fixed ceiling. Falls back
 *  to 1 for an all-zero series so nothing divides by zero. A loop rather
 *  than a spread, since an hour of peaks is more arguments than `Math.max`
 *  accepts. */
export function peakCeiling(...series: number[][]): number {
  let ceiling = 0;
  for (const peaks of series) {
    for (const peak of peaks) if (peak > ceiling) ceiling = peak;
  }
  return ceiling || 1;
}

/** Bars for one series against a shared ceiling, so two versions stay
 *  comparable. Resamples the raw peaks to a fixed bar count by bucket max, so
 *  quiet and loud sections keep their shape instead of being smoothed away by
 *  striding. */
export function toBars(
  peaks: number[],
  count: number,
  scale = peakCeiling(peaks)
): number[] {
  if (peaks.length === 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i / count) * peaks.length);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) / count) * peaks.length)
    );
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, peaks[j] ?? 0);
    return peak / scale;
  });
}
