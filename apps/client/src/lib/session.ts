import "server-only";
import { authServerClient, readCachedSessionCookie } from "@/lib/auth-server";
import { resolveSessionState, type SessionState } from "@/lib/session-state";
import { cache } from "react";

export * from "@/lib/session-state";

/**
 * Who is signed in. Better Auth mirrors the session into a signed
 * `session_data` cookie, so the common answer costs an HMAC check in this
 * process rather than a request to the API — which matters because every
 * `<Link>` prefetch renders its own page and asks again. The API is consulted
 * only when that cookie is absent or past its five minutes.
 */
export const getCachedSession = cache(async (): Promise<SessionState> => {
  const cached = await readCachedSessionCookie();

  if (cached) return resolveSessionState(cached, null);

  // A refused connection rejects rather than answering, and an unreachable API
  // is the case this whole read exists to tell apart from being signed out.
  const fetched = await authServerClient.getSession().catch(() => null);

  return resolveSessionState(null, fetched);
});
