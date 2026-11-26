import type { NewSession } from "@workspace/api/api";

import type { CoercedDraft } from "./new-row";

/**
 * A sessions table's coerced draft row as the create call's body. A track the
 * draft carries (seeded by a Track group header) wins; otherwise the session
 * belongs to `trackId`, the track whose page the table sits on, if any. A
 * row created inline has no dit repo behind it, so it is tagged `"manual"`
 * unless a DAW group header seeded its module id. The priority kind parses to
 * a level id; with none, the server gives the session the project's default.
 */
export function sessionFromDraft(
  draft: CoercedDraft,
  projectId: number,
  trackId?: number
): NewSession {
  return {
    name: String(draft.name),
    daw: draft.daw == null ? "manual" : String(draft.daw),
    dawName: draft.dawName == null ? undefined : String(draft.dawName),
    priorityId: draft.priority == null ? undefined : Number(draft.priority),
    trackId: draft.trackId == null ? trackId : Number(draft.trackId),
    projectId,
  };
}
