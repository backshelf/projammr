import type { SessionData } from "@/lib/auth-server";

export type SessionUser = SessionData["user"];
type SessionInfo = SessionData["session"];

/**
 * What the session read could establish. "Signed out" and "could not tell"
 * are separate cases on purpose: they used to share one representation, and a
 * transport failure reading as a signed-out visitor sends the app into a
 * redirect loop that keeps the failure alive.
 */
export type SessionState =
  | { kind: "member"; user: SessionUser; session: SessionInfo }
  | { kind: "guest"; user: SessionUser; session: SessionInfo }
  | { kind: "signed-out" }
  | { kind: "unavailable"; status?: number };

type FetchedSession = {
  data: SessionData | null;
  error: { status?: number } | null;
};

const identified = (data: SessionData): SessionState => ({
  kind: data.user.isAnonymous ? "guest" : "member",
  user: data.user,
  session: data.session,
});

/**
 * The verified cookie settles it on its own. Only when there is none does the
 * HTTP answer matter, and there a 401 is the single status that means nobody
 * is signed in — anything else is the API failing to answer.
 */
export function resolveSessionState(
  cached: SessionData | null,
  fetched: FetchedSession | null
): SessionState {
  if (cached) return identified(cached);
  if (!fetched) return { kind: "unavailable" };
  if (fetched.data) return identified(fetched.data);
  if (fetched.error && fetched.error.status !== 401) {
    return { kind: "unavailable", status: fetched.error.status };
  }
  return { kind: "signed-out" };
}

export const sessionUser = (state: SessionState): SessionUser | null =>
  state.kind === "member" || state.kind === "guest" ? state.user : null;

/**
 * Nobody a signed-in page is for. A guest counts: the anonymous session a
 * share page hands out reaches the share and invite pages and nothing else.
 * A session that could not be read does not count — the app keeps its authed
 * shape and lets the data fetches report their own failure.
 */
export const isSignedOut = (state: SessionState): boolean =>
  state.kind === "signed-out" || state.kind === "guest";
