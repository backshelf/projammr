import type { DawCapability } from "@workspace/api/lib/enums";

/** The DAW fields every capability check reads: a session's module id, its
 *  display name, and what it claims it can report. */
export type DawIdentity = {
  daw: string;
  dawName: string | null;
  dawCapabilities: string[];
};

/** Whether `session`'s DAW module claims `capability`. A session added by
 *  hand (`daw: "manual"`) claims none, so every gated field folds away
 *  rather than reading "Not set" for something no DAW will ever fill. */
export function dawCanReport(
  session: Pick<DawIdentity, "dawCapabilities">,
  capability: DawCapability
): boolean {
  return session.dawCapabilities.includes(capability);
}

/** A DAW module's id shape, matching the server's own
 *  `dawIdSchema` (lowercase, hyphenated, 1 to 32 characters). */
const DAW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Whether `value` could be a real DAW module id, rather than noise from a
 * hand-edited URL. The `daw` filter is open-ended (any module dit
 * registers, or "manual"), so this is a format check, not a lookup — the
 * server answers 400 for anything it doesn't recognise, which would
 * otherwise read as a project with no saves rather than a bad link.
 */
export function isDawId(value: string): boolean {
  return DAW_ID_PATTERN.test(value);
}

/**
 * The structure section's empty state, in one of three distinct readings: a
 * session added by hand has no file to read structure from, a DAW that never
 * reports structure never will regardless of how many times it is scanned,
 * and anything else just hasn't been scanned yet. Conflating any two of
 * these into "scan this session" tells the reader to retry something that
 * cannot work.
 */
export function structureEmptyLabel(session: DawIdentity): string {
  if (session.daw === "manual") {
    return "Sessions added by hand have no structure to show.";
  }
  if (!dawCanReport(session, "structure")) {
    return `${session.dawName ?? "This DAW"} doesn't report tracks and devices.`;
  }
  return "Track this session with dit to read its tracks and devices.";
}
