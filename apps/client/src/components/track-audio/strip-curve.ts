/**
 * SVG path segments for a curve strip (`LoudnessStrip`): a fraction series,
 * 0 at the strip's bottom edge and 1 at its top, plotted across equal bars
 * in a `0 0 count 100` viewBox. Split into one segment per contiguous run of
 * known values, so a gap (an unmeasured second) breaks the line instead of
 * drawing a false slope across it.
 */

const STRIP_VIEW_HEIGHT = 100;

const runsOf = (fractions: readonly (number | null)[]) => {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  fractions.forEach((fraction, i) => {
    if (fraction == null) {
      if (start !== -1) runs.push({ start, end: i - 1 });
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  });
  if (start !== -1) runs.push({ start, end: fractions.length - 1 });
  return runs;
};

const y = (fraction: number) => (1 - fraction) * STRIP_VIEW_HEIGHT;

/** An open polyline through each contiguous run of known values. */
export function curveSegments(fractions: readonly (number | null)[]): string[] {
  return runsOf(fractions).map(({ start, end }) => {
    let d = "";
    for (let i = start; i <= end; i++) {
      d += `${i === start ? "M" : "L"}${i + 0.5} ${y(fractions[i]!)}`;
    }
    return d;
  });
}

/** As {@link curveSegments}, each run closed down to the `baseline` fraction
 *  (default 0) for a fill under the curve. */
export function areaSegments(
  fractions: readonly (number | null)[],
  baseline = 0
): string[] {
  const baseY = y(baseline);
  return runsOf(fractions).map(({ start, end }) => {
    let d = "";
    for (let i = start; i <= end; i++) {
      d += `${i === start ? "M" : "L"}${i + 0.5} ${y(fractions[i]!)}`;
    }
    return `${d}L${end + 0.5} ${baseY}L${start + 0.5} ${baseY}Z`;
  });
}
