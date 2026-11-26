/** Pixels per millisecond above which the finger was throwing the surface. */
const FLICK_VELOCITY = 0.6;

/** The shortest travel a flick may be, so a twitch is not one. */
const FLICK_DISTANCE = 40;

/**
 * Whether a drag meant to commit: far enough on its own, or short but fast.
 * `travel` is the distance in the commit direction and `reach` is how far the
 * surface could travel, so a drag held at the stop commits however slowly it
 * was made. Distance alone makes a deliberate slow pull feel ignored;
 * velocity alone makes a twitch commit.
 */
export function flickCommits(
  travel: number,
  velocityPxPerMs: number,
  reach: number
) {
  return (
    travel >= reach ||
    (travel > FLICK_DISTANCE && velocityPxPerMs > FLICK_VELOCITY)
  );
}
