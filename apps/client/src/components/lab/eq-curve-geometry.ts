/**
 * Pointer and keyboard geometry for the EQ curve's draggable handles, in
 * fraction space (0..1 across the drawing's width and height) so a caller
 * only has to divide a pointer event's position by the element's own
 * `getBoundingClientRect()` — nothing here reads layout itself.
 */

import {
  HIGH_HZ,
  LOW_HZ,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  xOf,
  yOf,
} from "@/components/spectrum/spectrum-geometry";
import { paramRange } from "@/lib/dsp/lab-settings";
import { Param } from "@workspace/dsp/params";

// Every band shares one domain (`Eq1GainDb`/`Eq1Q` stand for all eight), so
// band 1's entry in the generated table is read as the chain's own bound.
const eq1Gain = paramRange(Param.Eq1GainDb);
const eq1Q = paramRange(Param.Eq1Q);

/** The gain axis the curve draws on: the chain's own `Eq*GainDb` domain. */
export const EQ_GAIN_WINDOW: readonly [number, number] = [
  eq1Gain.min,
  eq1Gain.max,
];

export type EqHandleBand = { hz: number; gainDb: number };

/** A handle's position, in fraction space (0,0 top-left; 1,1 bottom-right). */
export function bandFraction(
  band: EqHandleBand,
  window: readonly [number, number] = EQ_GAIN_WINDOW
): { x: number; y: number } {
  return {
    x: xOf(band.hz) / VIEW_WIDTH,
    y: yOf(band.gainDb, window) / VIEW_HEIGHT,
  };
}

/** The frequency a horizontal fraction stands for, log-spaced like `xOf`. */
export function hzAtFraction(
  fractionX: number,
  lowHz = LOW_HZ,
  highHz = HIGH_HZ
): number {
  const clamped = Math.min(1, Math.max(0, fractionX));
  return lowHz * Math.pow(highHz / lowHz, clamped);
}

/** The gain a vertical fraction stands for: 0 at the ceiling, 1 at the floor. */
export function gainAtFraction(
  fractionY: number,
  window: readonly [number, number] = EQ_GAIN_WINDOW
): number {
  const [floor, ceiling] = window;
  const clamped = Math.min(1, Math.max(0, fractionY));
  return ceiling - clamped * (ceiling - floor);
}

/** A pointer position translated straight to a band's frequency and gain —
 *  what an unmodified drag sets. */
export function dragToBand(
  fractionX: number,
  fractionY: number,
  window: readonly [number, number] = EQ_GAIN_WINDOW
): EqHandleBand {
  return {
    hz: hzAtFraction(fractionX),
    gainDb: gainAtFraction(fractionY, window),
  };
}

/** How far a pointer may land from a handle, in fraction space, and still
 *  claim it — wide horizontally (bands sit close together on the log axis)
 *  and generous vertically (the row is short in pixels). */
const HIT_X = 0.05;
const HIT_Y = 0.3;

/**
 * The handle nearest a pointer position, if any band is within reach — an
 * ellipse in fraction space rather than a circle, since the drawing is far
 * wider than it is tall.
 */
export function nearestBand(
  bands: readonly EqHandleBand[],
  fractionX: number,
  fractionY: number,
  window: readonly [number, number] = EQ_GAIN_WINDOW
): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  bands.forEach((band, index) => {
    const pos = bandFraction(band, window);
    const dx = (pos.x - fractionX) / HIT_X;
    const dy = (pos.y - fractionY) / HIT_Y;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best !== null && bestScore <= 1 ? best : null;
}

/** A keyboard nudge on a focused handle: 1 dB, or a tenth held fine. */
const GAIN_STEP_DB = 1;
const GAIN_STEP_FINE_DB = 0.1;

export function stepGain(
  gainDb: number,
  direction: 1 | -1,
  fine: boolean,
  window: readonly [number, number] = EQ_GAIN_WINDOW
): number {
  const [floor, ceiling] = window;
  const step = fine ? GAIN_STEP_FINE_DB : GAIN_STEP_DB;
  const next = Math.round((gainDb + direction * step) * 10) / 10;
  return Math.min(ceiling, Math.max(floor, next));
}

/** A 5% step per press, or 1% held fine — multiplicative, since the axis is log. */
const HZ_STEP_RATIO = 1.05;
const HZ_STEP_FINE_RATIO = 1.01;

export function stepHz(
  hz: number,
  direction: 1 | -1,
  fine: boolean,
  lowHz = LOW_HZ,
  highHz = HIGH_HZ
): number {
  const ratio = fine ? HZ_STEP_FINE_RATIO : HZ_STEP_RATIO;
  const next = Math.round(direction > 0 ? hz * ratio : hz / ratio);
  return Math.min(highHz, Math.max(lowHz, next));
}

export const Q_MIN = eq1Q.min;
export const Q_MAX = eq1Q.max;

/** Reference gain gridlines drawn behind the EQ curve, in dB. */
export const EQ_GRID_LEVELS = [-12, -6, 0, 6, 12] as const;

const WHEEL_Q_SENSITIVITY = 0.0025;
const WHEEL_Q_FINE_SENSITIVITY = 0.0006;

/**
 * Steps Q from a mouse-wheel `deltaY`: scrolling up (`deltaY < 0`) narrows
 * the filter (raises Q), scrolling down widens it. Rounded to two decimals
 * and clamped to `[Q_MIN, Q_MAX]`.
 */
export function stepQFromWheel(
  q: number,
  deltaY: number,
  fine: boolean
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return q;
  const scale = fine ? WHEEL_Q_FINE_SENSITIVITY : WHEEL_Q_SENSITIVITY;
  const next = q * Math.exp(-deltaY * scale);
  const clamped = Math.min(Q_MAX, Math.max(Q_MIN, next));
  return Math.round(clamped * 100) / 100;
}

/**
 * A shift-drag's vertical movement as a Q change: up narrows the response
 * (raises Q), down widens it, exponentially so the same pixel travel feels
 * even whichever end of the range Q is at.
 */
export function stepQFromDrag(q: number, deltaFractionY: number): number {
  const next = q * Math.exp(-deltaFractionY * 3);
  return Math.min(Q_MAX, Math.max(Q_MIN, next));
}

/** Where a shift-drag started: the Q it began from and the pointer's `y` then. */
export type QDragOrigin = { q: number; y: number };

/**
 * One shift-drag move: the Q it reports, and the origin to carry into the
 * next call. `origin` arrives `null` for the drag's first shift-held move (or
 * the first one after shift was released), so this move becomes the anchor —
 * every later move measures its `y` against that fixed point, rather than
 * against the previous move's own output, which would apply
 * {@link stepQFromDrag}'s multiplier again on top of an already-stepped Q for
 * every pointer event a held position still generates.
 */
export function qDragStep(
  origin: QDragOrigin | null,
  currentQ: number,
  y: number
): { origin: QDragOrigin; q: number } {
  const anchor = origin ?? { q: currentQ, y };
  return { origin: anchor, q: stepQFromDrag(anchor.q, y - anchor.y) };
}
