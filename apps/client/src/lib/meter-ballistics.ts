/**
 * How a meter's needle moves between readings: it rises quickly and falls
 * slowly, the way a studio meter's ballistics make a transient readable
 * without the needle jittering. Pure, so the display loop can be tested
 * without a frame clock.
 */

/** A meter's rise and fall time constants. */
export type Ballistics = { attackMs: number; releaseMs: number };

/**
 * `ballistics` with both times multiplied by `scale` — the visuals policy's
 * meter ballistics, which speeds every meter up or slows it down together
 * while each keeps its own feel relative to the others.
 */
export const scaledBallistics = (
  { attackMs, releaseMs }: Ballistics,
  scale: number
): Ballistics => ({ attackMs: attackMs * scale, releaseMs: releaseMs * scale });

/** Exponential approach with separate rise and fall time constants. */
export function follow(
  from: number,
  to: number,
  dtMs: number,
  { attackMs, releaseMs }: Ballistics
): number {
  const tau = to > from ? attackMs : releaseMs;
  if (tau <= 0 || dtMs <= 0) return dtMs <= 0 ? from : to;
  return to + (from - to) * Math.exp(-dtMs / tau);
}

/**
 * What a meter shows for `to`: eased through `follow` normally, or written
 * straight there under reduced motion. Reduced motion drops the easing, not
 * the update — a meter that stopped moving entirely would show a reading
 * that no longer matches its own text figure beside it.
 */
export function meterStep(
  from: number,
  to: number,
  dtMs: number,
  ballistics: Ballistics,
  reduced: boolean
): number {
  return reduced ? to : follow(from, to, dtMs, ballistics);
}

export type PeakHold = { value: number; heldMs: number };

/**
 * A held maximum: a new high jumps the marker up and restarts the hold; once
 * the hold runs out, the marker falls at `fallPerSecond` until the signal
 * meets it again.
 */
export function holdPeak(
  hold: PeakHold,
  reading: number,
  dtMs: number,
  { holdMs, fallPerSecond }: { holdMs: number; fallPerSecond: number }
): PeakHold {
  if (reading >= hold.value) return { value: reading, heldMs: 0 };
  const heldMs = hold.heldMs + dtMs;
  const overrun = Math.max(0, heldMs - holdMs);
  const fallen = hold.value - (fallPerSecond * Math.min(overrun, dtMs)) / 1000;
  return { value: Math.max(reading, fallen), heldMs };
}

/** The meter scale: −28 to 0 LUFS, the same ruler the integrated reading uses. */
const METER_FLOOR = -28;
const METER_CEILING = 0;

/** Where a LUFS value sits on the scale, 0..1; silence rests at the floor. */
export function meterFraction(lufs: number): number {
  if (!Number.isFinite(lufs)) return 0;
  const fraction = (lufs - METER_FLOOR) / (METER_CEILING - METER_FLOOR);
  return Math.max(0, Math.min(1, fraction));
}

/**
 * How lit the room is by the music, 0..1: mostly the short-term level (how
 * loud the passage is), lifted by how far the momentary level jumps above it
 * (a hit landing). A quiet intro keeps the art near rest; a chorus opens it.
 */
export function roomEnergy(momentary: number, shortTerm: number): number {
  if (!Number.isFinite(shortTerm)) return 0;
  const level = Math.max(0, Math.min(1, (shortTerm + 36) / 28));
  const lift = Number.isFinite(momentary)
    ? Math.max(0, Math.min(1, (momentary - shortTerm) / 6))
    : 0;
  return Math.min(1, level * 0.7 + lift * 0.3 + level * lift * 0.15);
}
