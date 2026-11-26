/**
 * The scrubber's arithmetic, apart from the component so the bounds and the
 * keyboard steps can be exercised without a DOM.
 */

import { formatSeconds } from "@workspace/ui/lib/format";
import type { PlayerTimeDisplay } from "@workspace/ui/lib/formatters";

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/**
 * The position a pointer `ratio` of the way across the track selects. A drag
 * that ran past either end of the track lands on its bounds.
 */
export const clampPosition = (ratio: number, duration: number) =>
  clamp(ratio, 1) * duration;

/**
 * The position a key moves to, an arrow moving by `step` seconds, or `null`
 * for a key the scrubber does not answer so the event is left to the page.
 */
export function keyboardSeek(
  key: string,
  current: number,
  duration: number,
  step: number
): number | null {
  const targets: Record<string, number | undefined> = {
    ArrowRight: current + step,
    ArrowLeft: current - step,
    Home: 0,
    End: duration,
  };

  const target = targets[key];
  return target === undefined ? null : clamp(target, duration);
}

export type ProgressReadout = {
  /** The position in seconds, held inside a known duration. */
  position: number;
  /** How far along the track the position is, from 0 to 1. */
  fraction: number;
  /** The time before the bar and the time after it, as the player time
   *  display says. */
  lead: string;
  trail: string;
  /** The slider's spoken value. */
  valueText: string;
};

/** A time the duration is needed for, while it is still unknown. */
const UNKNOWN = "--:--";

/** The three times a position reads as: played, left with its minus sign,
 *  and the whole track. */
type Times = { elapsed: string; remaining: string; total: string };

/** Which of the three times each player time display puts either side of
 *  the bar. */
const SLOTS: Record<PlayerTimeDisplay, (times: Times) => [string, string]> = {
  "elapsed-remaining": ({ elapsed, remaining }) => [elapsed, remaining],
  "elapsed-total": ({ elapsed, total }) => [elapsed, total],
  remaining: ({ remaining, total }) => [remaining, total],
};

/**
 * Everything a progress reader writes for one position, its two times laid
 * out as `display` says. The position can run a frame past the end before
 * the engine reports it, so it is held to the duration rather than drawing a
 * fill wider than its track.
 */
export function progressReadout(
  seconds: number,
  duration: number,
  display: PlayerTimeDisplay
): ProgressReadout {
  const known = duration > 0;
  const position = known ? clamp(seconds, duration) : Math.max(0, seconds);
  const elapsed = formatSeconds(known ? position : seconds);
  const [lead, trail] = SLOTS[display]({
    elapsed,
    remaining: known ? `-${formatSeconds(duration - position)}` : UNKNOWN,
    total: known ? formatSeconds(duration) : UNKNOWN,
  });
  return {
    position,
    fraction: known ? position / duration : 0,
    lead,
    trail,
    valueText: known ? `${elapsed} of ${formatSeconds(duration)}` : elapsed,
  };
}
