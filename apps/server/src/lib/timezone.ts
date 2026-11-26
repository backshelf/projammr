/**
 * Every IANA zone name Node knows about, computed once at module load. An
 * unknown zone interpolated into a Postgres `AT TIME ZONE` clause throws a
 * 500 rather than answering a 400, so every heatmap route validates against
 * this set before the zone reaches SQL.
 */
const SUPPORTED_TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

// "UTC" is the default this API falls back to but is not itself an IANA zone
// name, so `Intl.supportedValuesOf` omits it.
export const isSupportedTimeZone = (tz: string): boolean =>
  tz === "UTC" || SUPPORTED_TIME_ZONES.has(tz);
