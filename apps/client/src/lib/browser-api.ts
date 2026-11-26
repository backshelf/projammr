"use client";

import { createBrowserApiClient } from "@workspace/api/lib/authed-client";

/**
 * The API client for fetches made in the browser. Requests go to `/api/*` on
 * this origin, which `next.config.ts` forwards to the API server, so the
 * HttpOnly session cookie authenticates them.
 */
export const browserApi = createBrowserApiClient();
