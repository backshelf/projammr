/**
 * Resamples a per-second (or otherwise evenly spaced) series onto a fixed
 * number of bars by bucket mean rather than by bucket max, since a mean is
 * what preserves a curve's shape or a change value's own share instead of
 * spiking to whichever second in the bucket happened to peak. Shared by
 * `LoudnessStrip` (a curve) and `ChangeStrip` (a per-bar change fraction).
 */
export function resampleMean(
  values: readonly (number | null)[],
  count: number
): (number | null)[] {
  if (values.length === 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i / count) * values.length);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) / count) * values.length)
    );
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      const value = values[j];
      if (value != null) {
        sum += value;
        n++;
      }
    }
    return n === 0 ? null : sum / n;
  });
}
