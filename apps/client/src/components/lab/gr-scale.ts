import type { RulerConfig } from "@workspace/session-diff/ruler";
import { formatSignedDecimal } from "@workspace/ui/lib/loudness";

/**
 * How {@link GrMeter} reads a gain-reduction figure: the ruler it hangs on,
 * the bar's travel and the figure above it. The chain reports reduction as a
 * positive dB figure (0 at rest, `Meter.GainReductionDb` in
 * `@workspace/dsp/params`); the ruler and the figure show it as the cut it
 * is. Pure, so the scale can be tested without a frame loop.
 */

/** The reduction, in dB, at full travel. A harder-working compressor simply
 *  pins at the edge. */
const FULL_DB = 24;
/** Below this the figure reads as no reduction. */
const SHOWN_DB = 0.05;

/** −24..0 dB with no reduction at the right-hand end, so the bar hangs from
 *  0 and reaches left as the compressor works — the loudness ruler's drawing
 *  run through the gain-reduction domain. */
export const GR_RULER: RulerConfig = {
  min: -FULL_DB,
  max: 0,
  stops: [-24, -12, -6, -3, 0],
  unit: "dB",
  format: (db) => (db === 0 ? "0" : `−${Math.abs(db)}`),
};

/** The bar's travel from the ruler's 0 dB end, 0..1, for a reduction of
 *  `db`; 0 for a NaN reading. */
export const grFraction = (db: number) =>
  Number.isNaN(db) ? 0 : Math.max(0, Math.min(1, db / FULL_DB));

/** The figure for a reduction of `db`. */
export const grLabel = (db: number) =>
  `${db >= SHOWN_DB ? formatSignedDecimal(-db) : "0.0"} dB`;
