import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  linkTrackAudiosResultSchema,
  getTrackAudios,
  linkTrackAudios,
} from "../../db/queries/track-audios.js";
import { db } from "../../db/index.js";
import { assets } from "../../db/schema/assets.js";
import { saves } from "../../db/schema/saves.js";
import { trackAudios } from "../../db/schema/tracks.js";
import { ApiError } from "../../lib/http.js";
import { isAudioName } from "../../lib/media.js";
import { bulkAttachToSessions, getSessionRow } from "./queries.js";

/** What `acceptRender` returns, and what `POST /sessions/:id/renders` sends back. */
export const renderAcceptedSchema = linkTrackAudiosResultSchema.extend({
  trackId: z.number(),
  attached: z.literal(true),
});

/**
 * Accepts a render of a session: attaches its audio file to the session, links
 * it as a version of the session's track, and records the save it was bounced
 * from (null when none). Accepting the same render again converges on the same
 * rows, and the bounce is set to what the latest accept sent.
 */
export async function acceptRender(
  sessionId: number,
  assetId: number,
  bouncedFromSaveId: number | null
): Promise<z.infer<typeof renderAcceptedSchema>> {
  const session = await getSessionRow(sessionId);
  if (!session) throw new HTTPException(404, { message: "Session not found" });
  if (session.trackId === null) {
    throw new ApiError(409, {
      code: "session_has_no_track",
      message: "The session has no track to render into",
    });
  }

  const [asset] = await db
    .select({ id: assets.id, name: assets.name, projectId: assets.projectId })
    .from(assets)
    .where(eq(assets.id, assetId));
  if (!asset || asset.projectId !== session.projectId) {
    throw new HTTPException(404, { message: "Asset not found" });
  }
  if (!isAudioName(asset.name)) {
    throw new ApiError(400, {
      code: "not_audio",
      message: "A render must be an audio file",
    });
  }

  if (bouncedFromSaveId !== null) {
    const [save] = await db
      .select({ sessionId: saves.sessionId })
      .from(saves)
      .where(eq(saves.id, bouncedFromSaveId));
    if (!save || save.sessionId !== sessionId) {
      throw new ApiError(400, {
        code: "save_not_in_session",
        message: "The bounced save is not a save of this session",
      });
    }
  }

  await bulkAttachToSessions([{ sessionId, assetId }]);
  const linked = await linkTrackAudios(session.trackId, [assetId]);
  await db
    .update(trackAudios)
    .set({ bouncedFromSaveId })
    .where(
      and(
        eq(trackAudios.trackId, session.trackId),
        eq(trackAudios.assetId, assetId)
      )
    );

  return {
    analysisJobIds: linked.analysisJobIds,
    audios: await getTrackAudios(session.trackId),
    trackId: session.trackId,
    attached: true,
  };
}
