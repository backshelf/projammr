import { isTimeZone } from "@workspace/ui/lib/formatters";

/**
 * The cookie the browser keeps its own IANA time zone in, so a server render
 * can read dates in the viewer's zone rather than its own. `ZoneCookie`
 * writes it on every load; `viewerFormat()` reads it.
 */
export const ZONE_COOKIE = "viewer_zone";

/** A year: rewritten on every load, so only a browser that stops visiting
 *  lets it lapse. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** The zone a cookie value names, or null when there is none or the runtime
 *  does not know it: the value comes from the browser, so it is checked
 *  rather than trusted. */
export function zoneFromCookie(value: string | undefined): string | null {
  return value && isTimeZone(value) ? value : null;
}

/** The `document.cookie` assignment that keeps `zone`. An IANA name is made
 *  of characters a cookie value may carry, so it is written as it is. */
export function zoneCookie(zone: string): string {
  return `${ZONE_COOKIE}=${zone}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
