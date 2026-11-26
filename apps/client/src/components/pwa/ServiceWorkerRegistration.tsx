"use client";

import { useEffect } from "react";

/**
 * Registers the worker in `public/sw.js`, and renders nothing. Only a
 * production build has one: a dev server rewrites its chunks on every edit, and
 * a cached chunk list breaks the page it belongs to.
 *
 * `updateViaCache: "none"` keeps the HTTP cache out of the update check, so a
 * new worker is picked up on the first cold start after a deploy.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // A browser in private mode, or one with storage denied, simply goes
        // without: nothing in the app depends on the worker being there.
      });
  }, []);

  return null;
}
