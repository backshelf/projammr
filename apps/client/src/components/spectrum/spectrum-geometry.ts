/*
 * The drawing's coordinate system. A spectrum is drawn in a fixed viewBox and
 * stretched to whatever width it is given, so every helper here works in view
 * units and nothing reads layout.
 */

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 100;
export const LOW_HZ = 20;
export const HIGH_HZ = 20000;

/** Where a frequency lands across the drawing, 0..VIEW_WIDTH on a log axis. */
export const xOf = (hz: number) =>
  (Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ)) * VIEW_WIDTH;

/** Where a level lands down the drawing: the ceiling at 0, the floor at VIEW_HEIGHT, clamped. */
export const yOf = (
  db: number,
  [floor, ceiling]: readonly [number, number]
) => {
  const fraction = (db - floor) / (ceiling - floor);
  return VIEW_HEIGHT - Math.min(1, Math.max(0, fraction)) * VIEW_HEIGHT;
};

const point = (hz: number, db: number, window: readonly [number, number]) =>
  `${xOf(hz).toFixed(1)} ${yOf(db, window).toFixed(1)}`;

/** An open polyline through every band. */
export function curvePath(
  hz: readonly number[],
  db: ArrayLike<number>,
  window: readonly [number, number]
) {
  let d = "";
  for (let i = 0; i < hz.length; i++)
    d += `${i === 0 ? "M" : "L"}${point(hz[i]!, db[i]!, window)}`;
  return d;
}

/** The curve closed down to the floor, for a fill under it. */
export function areaPath(
  hz: readonly number[],
  db: ArrayLike<number>,
  window: readonly [number, number]
) {
  if (hz.length === 0) return "";
  return `${curvePath(hz, db, window)}L${xOf(hz[hz.length - 1]!).toFixed(1)} ${VIEW_HEIGHT}L${xOf(hz[0]!).toFixed(1)} ${VIEW_HEIGHT}Z`;
}

/** The curve closed along the horizontal line at `levelDb`, for a fill
 *  between the two: above the line where the curve rises past it, below it
 *  where the curve dips. */
export function fillToLevelPath(
  hz: readonly number[],
  db: ArrayLike<number>,
  window: readonly [number, number],
  levelDb: number
) {
  if (hz.length === 0) return "";
  const y = yOf(levelDb, window).toFixed(1);
  return `${curvePath(hz, db, window)}L${xOf(hz[hz.length - 1]!).toFixed(1)} ${y}L${xOf(hz[0]!).toFixed(1)} ${y}Z`;
}

/** The band between two curves: forward along `max`, back along `min`. */
export function envelopePath(
  hz: readonly number[],
  min: readonly number[],
  max: readonly number[],
  window: readonly [number, number]
) {
  if (hz.length === 0) return "";
  let d = curvePath(hz, max, window);
  for (let i = hz.length - 1; i >= 0; i--)
    d += `L${point(hz[i]!, min[i]!, window)}`;
  return `${d}Z`;
}

/** Ruler stops; the labelled ones carry a numeral, the rest a tick. */
export const SPECTRUM_RULER = [
  20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
] as const;
export const SPECTRUM_LABELLED = new Set<number>([20, 100, 1000, 10000]);
export const hzLabel = (hz: number) =>
  hz >= 1000 ? `${hz / 1000}k` : String(hz);
