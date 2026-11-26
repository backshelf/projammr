import { authClient } from "@workspace/api/lib/auth-client";
import { IMAGE_CACHE } from "./sw-classify";

/**
 * Ends the session and reloads: the shell is server-rendered from the session
 * cookie, so the signed-out tree only appears on a fresh request. The artwork
 * the service worker kept is another project's members' to see, so it leaves
 * with the session.
 */
export async function signOut() {
  await authClient.signOut();
  if ("caches" in window) await caches.delete(IMAGE_CACHE);
  window.location.reload();
}
