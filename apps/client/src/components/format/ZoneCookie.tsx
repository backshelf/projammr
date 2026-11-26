"use client";

import { zoneCookie } from "@/lib/zone-cookie";
import { runtimeZone } from "@workspace/ui/lib/formatters";
import { useEffect } from "react";

/**
 * Writes the browser's own time zone into the zone cookie once per load, so
 * the next server render reads dates where the viewer is, and renders
 * nothing. A browser's very first page was formatted in the server's zone;
 * `FormatProvider` corrects that one on the client.
 */
export function ZoneCookie() {
  useEffect(() => {
    document.cookie = zoneCookie(runtimeZone());
  }, []);

  return null;
}
