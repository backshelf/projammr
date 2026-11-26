/**
 * The arithmetic behind {@link RulerScale}, apart from the component so a
 * domain's own numbers can be checked without a DOM: where a value lands
 * along the ruler, and the fixed shape (range, ticks, reference, formatting)
 * that makes one domain (loudness, tempo, …) read as a preset over the same
 * drawing.
 */

import type { RulerConfig, RulerMark } from "@workspace/session-diff/ruler";
import type { Formatters } from "@workspace/ui/lib/formatters";

/** Where `value` lands along `min`..`max`, as a percentage clamped to the
 *  ruler's own ends. */
export function positionOf(value: number, min: number, max: number): number {
  const pct = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** A mark's tooltip: its label, the formatted value, and the config's unit
 *  when it has one. */
export function markTitle(config: RulerConfig, mark: RulerMark): string {
  const value = (config.formatMark ?? config.format)(mark.value);
  return config.unit
    ? `${mark.label} · ${value} ${config.unit}`
    : `${mark.label} · ${value}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many numbered stops a time ruler carries, ends included. */
const TIME_STOPS = 5;

/**
 * A span of time as a ruler, the commit ruler's domain: `min` and `max` are
 * epoch milliseconds and the stops are evenly spaced, the ends included, so a
 * mark's place is `positionOf(at, min, max)` like any other domain's. A span of
 * a day or less is numbered in clock times, longer ones in dates, both written
 * in the viewer's zone by their `format`. An empty span (one instant) is
 * widened to a day so a lone mark still has somewhere to stand.
 */
export function timeRuler(
  from: number,
  to: number,
  format: Formatters
): RulerConfig {
  const min = from;
  const max = to > from ? to : from + DAY_MS;
  const step = (max - min) / (TIME_STOPS - 1);
  return {
    min,
    max,
    stops: Array.from({ length: TIME_STOPS }, (_, i) => min + i * step),
    format:
      max - min <= DAY_MS ? (at) => format.time(at) : (at) => format.date(at),
  };
}
