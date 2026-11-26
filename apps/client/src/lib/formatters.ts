import "server-only";
import { formatPrefsFrom } from "@/lib/policies/from-settings";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { ZONE_COOKIE, zoneFromCookie } from "@/lib/zone-cookie";
import {
  type FormatPrefs,
  type Formatters,
  formattersFor,
  runtimeZone,
} from "@workspace/ui/lib/formatters";
import { cookies } from "next/headers";
import { cache } from "react";

// React's `cache` keys on the arguments as passed, so `f()` and `f(undefined)`
// would be two entries; the exports below fold both into `null`.
const formatRead = cache(
  async (
    projectId: number | null
  ): Promise<{ prefs: FormatPrefs; zone: string }> => {
    const [cookieStore, settings] = await Promise.all([
      cookies(),
      cachedEffectiveSettings(projectId ?? undefined),
    ]);
    return {
      prefs: formatPrefsFrom(settings.values),
      zone:
        zoneFromCookie(cookieStore.get(ZONE_COOKIE)?.value) ?? runtimeZone(),
    };
  }
);

const formattersRead = cache(async (projectId: number | null) => {
  const { prefs, zone } = await formatRead(projectId);
  return formattersFor(prefs, zone);
});

/**
 * The viewer's format preferences for this request, from their effective
 * settings, and the zone "auto" resolves to: the zone cookie the browser
 * keeps, else this server's own zone (a browser's first request, before it
 * has written one). The root layout hands both to `FormatProvider`, so the
 * client hydrates in the zone the server formatted in. A render on a project's
 * route passes the project's id, so the project's layer of the settings applies.
 */
export const viewerFormat = (projectId?: number) =>
  formatRead(projectId ?? null);

/**
 * The viewer's formatter set for a server render, built once per request for
 * each project.
 */
export const cachedFormatters = (projectId?: number): Promise<Formatters> =>
  formattersRead(projectId ?? null);
