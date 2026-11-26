/** The last-save phrase shared by the project WORK lede and the track rail
 *  caption: `today`, `yesterday`, or `{n} days ago`. `since` is the number of
 *  days `streaks()` reports have passed since the most recent active day. */
export function lastSaveLabel(since: number): string {
  if (since === 0) return "today";
  if (since === 1) return "yesterday";
  return `${since} days ago`;
}
