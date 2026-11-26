/** One decimal place, with a typographic minus and an explicit plus. */
export function formatSignedDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0";
  const magnitude = Math.abs(rounded).toFixed(1);
  return rounded < 0 ? `−${magnitude}` : `+${magnitude}`;
}

/** Integrated loudness keeps no plus sign: it is never meaningfully positive. */
export function formatLufs(lufs: number): string {
  return formatSignedDecimal(lufs).replace(/^\+/, "");
}

/** The true-peak figure alone, without the "TP" unit — pairs with
 *  `<LoudnessUnit unit="TP">` so the unit and the value render as separate
 *  elements, the unit carrying the explanatory tooltip. */
export function formatTruePeakValue(truePeakDb: number): string {
  return `${formatSignedDecimal(truePeakDb)} dB`;
}

export function formatTruePeak(truePeakDb: number): string {
  return `TP ${formatTruePeakValue(truePeakDb)}`;
}

/**
 * How much of a collection's loudness scan is done. `total` counts only
 * tracks that have audio at all, so a collection with unfinished tracks
 * never reads as if it had fewer tracks than it does.
 */
export function loudnessMeasuredLabel(measured: number, total: number): string {
  return measured < total
    ? `${measured} of ${total} measured`
    : `${measured} measured`;
}
