import type { ActionError, ShareOption, Sharelink } from "@workspace/api/api";
import { formatTimecode } from "@workspace/ui/lib/format";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * "No expiry" is a far-future timestamp rather than a null, because the column
 * is `NOT NULL` and Postgres' `infinity` does not survive the driver. The
 * control is therefore "never / a date", and "never" writes this.
 */
export const NEVER_EXPIRES = "9999-12-31T23:59:59.000Z";

/** Anything this far out is the sentinel, however the driver rounded it. */
const NEVER_THRESHOLD = Date.UTC(9000, 0, 1);

export function neverExpires(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() >= NEVER_THRESHOLD;
}

export function hasExpired(expiresAt: string, now = Date.now()): boolean {
  return !neverExpires(expiresAt) && new Date(expiresAt).getTime() < now;
}

/** The `value` an `<input type="date">` shows for an expiry, in local time. */
export function toDateInputValue(expiresAt: string): string {
  const date = new Date(expiresAt);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A picked day expires at the end of it: someone choosing "expires on the
 * 9th" means the link works through the 9th, not that it dies at its midnight.
 */
export function fromDateInputValue(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 23, 59, 59, 999).toISOString();
}

export const SHARE_TYPE_DESCRIPTIONS: Record<Sharelink["shareType"], string> = {
  connected: "Always plays whatever the current primary version is.",
  snapshot: "Freezes the exact versions chosen now, whatever changes later.",
};

/** What a link's row says about when it stops working. */
export function expiryLabel(
  expiresAt: string,
  format: Formatters,
  now = Date.now()
): string {
  if (neverExpires(expiresAt)) return "Never expires";
  const when = format.date(expiresAt);
  return hasExpired(expiresAt, now) ? `Expired ${when}` : `Expires ${when}`;
}

/**
 * The version a snapshot reaches for unless told otherwise. The primary is
 * what "the track" means, and it is not always the newest — a take can be
 * promoted back over a later one.
 */
export function defaultAudio(track: ShareOption) {
  return track.audios.find((audio) => audio.isPrimary) ?? track.audios[0];
}

/** The path a share is read at. The origin is the app's own, so it is left to
 *  the browser rather than guessed on the server. */
export const sharePath = (token: string) => `/share/${token}`;

/** Why a share link reads as dead. */
export type ShareErrorKind = "expired" | "revoked" | "invalid";

/**
 * Which dead-link shell a failed share read gets, from the status and the
 * envelope's `code`. `null` is for a failure that says nothing about the link
 * (a 429, a 5xx), which belongs to the error boundary.
 */
export function shareErrorKind(error: ActionError): ShareErrorKind | null {
  if (error.status === 410)
    return error.code === "revoked" ? "revoked" : "expired";
  if (error.status === 404) return "invalid";
  return null;
}

export const SHARE_UNAVAILABLE: Record<
  ShareErrorKind,
  { title: string; body: string }
> = {
  invalid: {
    title: "This share link isn't valid",
    body: "Check the address you were sent, or ask for a new link.",
  },
  expired: {
    title: "This share link has expired",
    body: "Ask whoever sent it to extend it or share a new one.",
  },
  revoked: {
    title: "This share link was turned off",
    body: "Its owner stopped sharing it. Ask them for a new one.",
  },
};

/**
 * A failed call on a share link says what the share page would about a dead
 * one: a revoked link was turned off, not expired. The two are both 410s told
 * apart by the envelope's `code`, which a per-status message cannot see.
 */
export function shareActionError(error: ActionError): ActionError {
  const kind = shareErrorKind(error);
  return kind ? { ...error, error: SHARE_UNAVAILABLE[kind].title } : error;
}

/** What a share is called on its page, in its unfurl and on its poster. */
export function shareTitle(sharelink: Sharelink): string {
  return sharelink.title ?? "Shared audio";
}

/** A total playing time in whole minutes: "14 min", "<1 min", "1 h 4 min". */
function formatMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * The line under a share's title: what was shared and how big it is. A segment
 * the share cannot back with a number is left out rather than guessed.
 */
export function shareFacts(sharelink: Sharelink): string {
  if (sharelink.entityType === "track") {
    const audio = sharelink.tracks[0]?.trackAudio;
    return [
      "Shared track",
      audio?.durationMs ? formatTimecode(audio.durationMs) : null,
      audio?.version !== undefined ? `version ${audio.version}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const playable = sharelink.tracks.filter(
    (track) => track.trackAudio.id !== undefined
  );
  const totalMs = playable.reduce(
    (sum, track) => sum + (track.trackAudio.durationMs ?? 0),
    0
  );
  return [
    "Shared collection",
    playable.length > 0 ? pluralizeCount(playable.length, "track") : null,
    totalMs > 0 ? formatMinutes(totalMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
