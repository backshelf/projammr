import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { projectIdForTrackAudio } from "../../db/queries/track-audios.js";
import { trackAudios } from "../../db/schema/tracks.js";
import type { CommentTarget } from "../types.js";

/**
 * An audio version is something to comment on but not an entity of its own:
 * it has no CRUD surface, no artwork and no listing. A comment on one belongs
 * to the track it is a version of — the audio itself is not something the
 * activity feed can name.
 */
export const trackAudioTarget: CommentTarget = {
  kind: "track_audio",
  projectIdFor: projectIdForTrackAudio,
  activityTarget: async (id) => {
    const [row] = await db
      .select({ trackId: trackAudios.trackId })
      .from(trackAudios)
      .where(eq(trackAudios.id, id));

    return row ? { entityType: "track", entityId: row.trackId } : null;
  },
  // The duplicate removal deletes a copy's version only when its audit finds
  // no comment on it, holding the version `FOR UPDATE` from before the audit
  // to the commit. A comment waits that out and then finds the row gone.
  lockForComment: async (tx, id) => {
    const [row] = await tx
      .select({ id: trackAudios.id })
      .from(trackAudios)
      .where(eq(trackAudios.id, id))
      .for("share");
    return row !== undefined;
  },
};
