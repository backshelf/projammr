import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { COMMENT_TARGETS, ENTITIES } from "../../entities/index.js";
import { getSharelinkTracksInCollection } from "../../entities/collection/queries.js";
import { getSharelinkTrack } from "../../entities/track/queries.js";
import { DAY_MS } from "../../lib/duration.js";
import { ApiError } from "../../lib/http.js";
import { nullsToUndefined } from "../../lib/utils.js";
import { db, type Tx } from "../index.js";
import { isForeignKeyViolation } from "../unique-violation.js";
import { type Asset, assets } from "../schema/assets.js";
import { collections, collectionTracks } from "../schema/collections.js";
import {
  SHARELINK_ENTITIES,
  SHARELINK_TYPES,
  type Sharelink,
  sharelinks,
  sharelinkSchema,
  sharelinkSnapshotTrackAudios,
} from "../schema/sharelinks.js";
import {
  type TrackAudio,
  spectrumSchema,
  trackAudios,
  sharedTrackAudioColumns,
  trackAudioSchema,
  tracks,
} from "../schema/tracks.js";
import {
  type Artwork,
  artworkJsonFromPath,
  artworkSchema,
  trackImagePathSql,
} from "./artwork.js";
import { isMemberAtLeast } from "./authorization.js";
import { projectPolicy } from "./project-policy.js";
import {
  createComment,
  deleteComment,
  getCommentsForTarget,
  getCommentTarget,
  updateComment,
} from "./comments.js";

// `nullsToUndefined` (applied below) recurses into arrays, so a stored `null`
// inside `loudnessCurve` (a gated second) comes out `undefined` too, not just
// a missing column — the one `TrackAudio` field whose element type needs the
// same substitution as its own nullability.
type SharelinkTrackAudio = Omit<TrackAudio, "loudnessCurve"> &
  Pick<Asset, "name" | "type" | "size" | "assetPath"> & {
    loudnessCurve: (number | undefined)[] | undefined;
  };

export type SharelinkTrack = {
  id: number;
  title?: string;
  position?: number;
  trackAudio: Partial<SharelinkTrackAudio>;
};

/** A shared track once its cover has been resolved — what a guest reads, since
 *  the share page tints itself from the artwork it cannot otherwise fetch. */
export type SharelinkTrackWithArtwork = SharelinkTrack & {
  artwork: Artwork | null;
};

type SharelinkEntity = Sharelink["entityType"];

const sharelinkTrackAudioSchema = trackAudioSchema
  .omit({ primaryPinned: true, bouncedFromSaveId: true })
  .extend({
    name: z.string(),
    type: z.string(),
    size: z.number(),
    assetPath: z.string(),
    // Carried here although list responses omit them: a share is a handful of
    // tracks, and its reader cannot reach the peaks or spectrum endpoints to
    // draw a waveform with.
    audioPeaks: z.array(z.number()).nullable(),
    ltas: spectrumSchema.nullable(),
  })
  .partial();

const sharelinkTrackSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  position: z.number().optional(),
  trackAudio: sharelinkTrackAudioSchema,
  artwork: artworkSchema.nullable(),
});

/** The response for `GET /share/:token`: the row, plus a resolved display
 * title and the tracks it currently grants access to. */
export const sharelinkWithTracksSchema = sharelinkSchema.extend({
  title: z.string().optional(),
  tracks: z.array(sharelinkTrackSchema),
});

/** The row for a token whatever state it is in, revoked or expired included. */
async function readSharelinkRow(token: string) {
  const [result] = await db
    .select()
    .from(sharelinks)
    .where(eq(sharelinks.token, token));
  if (!result) throw new HTTPException(404);
  return result;
}

/**
 * The row as managing a link (editing, converting, extending, turning off)
 * reads it. It has no opinion on expiry, since an editor must be able to
 * revive an expired link rather than being locked out of the row that names
 * its own new `expiresAt`; a revoked link is gone, as if it never existed.
 */
async function findSharelinkRow(token: string) {
  const result = await readSharelinkRow(token);
  if (result.revokedAt) throw new HTTPException(404);
  return result;
}

/** What a guest's request reads: the row, rejecting a revoked link and then
 * an expired one before anything else looks at it. */
async function getSharelinkRow(token: string) {
  const result = await readSharelinkRow(token);
  if (result.revokedAt) {
    throw new ApiError(410, {
      code: "revoked",
      message: "This share link was turned off",
    });
  }
  if (result.expiresAt.getTime() < Date.now()) {
    throw new ApiError(410, {
      code: "expired",
      message: "This share link has expired",
    });
  }
  return result;
}

async function liveEntityTitle(
  entityType: SharelinkEntity,
  entityId: number
): Promise<string | undefined> {
  const [row] =
    entityType === "track"
      ? await db
          .select({ title: tracks.title })
          .from(tracks)
          .where(eq(tracks.id, entityId))
      : await db
          .select({ title: collections.title })
          .from(collections)
          .where(eq(collections.id, entityId));
  return row?.title ?? undefined;
}

async function liveEntityTracks(
  entityType: SharelinkEntity,
  entityId: number
): Promise<SharelinkTrack[]> {
  return entityType === "collection"
    ? getSharelinkTracksInCollection(entityId)
    : [await getSharelinkTrack(entityId)];
}

/** Whoever created the link must have been able to edit the entity it shares. */
async function assertMayManage(
  entityType: SharelinkEntity,
  entityId: number,
  actorId: string
): Promise<number> {
  const projectId = await ENTITIES[entityType].projectIdFor(entityId);
  if (projectId == null) {
    throw new HTTPException(404, { message: `${entityType} not found` });
  }
  if (!(await isMemberAtLeast(actorId, projectId, "editor"))) {
    throw new HTTPException(403, {
      message: "Only a project editor can manage a share link for this",
    });
  }
  return projectId;
}

async function assertMayManageSharelink(sharelink: Sharelink, actorId: string) {
  await assertMayManage(sharelink.entityType, sharelink.entityId, actorId);
}

/** The revoke timestamp is server-side only; parsing through the response
 *  schema, which omits it, keeps it out of every body. */
function withoutRevokedAt(sharelink: Sharelink) {
  return sharelinkSchema.parse(sharelink);
}

async function buildSharelinkResponse(sharelink: Sharelink) {
  const trackList = await getSharelinkTracks(sharelink);
  const title =
    sharelink.snapshotTitle ??
    (sharelink.shareType === "connected"
      ? await liveEntityTitle(sharelink.entityType, sharelink.entityId)
      : undefined);

  return { ...withoutRevokedAt(sharelink), title, tracks: trackList };
}

/**
 * What a guest reads. A snapshot drops the uploaded filename from every track:
 * it is the live name of the file on disk, which the frozen titles exist to
 * stand in for, and it would otherwise travel in the response and in the name
 * a download is saved under. The editor-facing reads keep it.
 */
export async function getSharelink(token: string) {
  const sharelink = await getSharelinkRow(token);
  const response = await buildSharelinkResponse(sharelink);
  if (sharelink.shareType !== "snapshot") return response;

  return {
    ...response,
    tracks: response.tracks.map((track) => ({
      ...track,
      trackAudio: { ...track.trackAudio, name: undefined },
    })),
  };
}

/**
 * A link as the editor managing it sees it. Expanding the tracks can fail —
 * a connected link whose track has lost its primary audio has nothing live to
 * resolve — and a link that cannot be expanded is still one they must be able
 * to see, edit and delete, so it is listed with an empty track list rather
 * than taking the whole list down with it.
 */
async function manageableSharelinkResponse(sharelink: Sharelink) {
  try {
    return await buildSharelinkResponse(sharelink);
  } catch {
    return { ...withoutRevokedAt(sharelink), title: undefined, tracks: [] };
  }
}

/**
 * Every link an entity has that is still turned on, expired ones included: a
 * token is only handed back once, at creation, so a link an editor cannot see
 * here is a link they can never reach again — and an expired one is exactly
 * what they came to extend. A revoked link is gone.
 */
export async function listSharelinks(
  entityType: SharelinkEntity,
  entityId: number,
  actorId: string
) {
  await assertMayManage(entityType, entityId, actorId);

  const rows = await db
    .select()
    .from(sharelinks)
    .where(
      and(
        eq(sharelinks.entityType, entityType),
        eq(sharelinks.entityId, entityId),
        isNull(sharelinks.revokedAt)
      )
    )
    .orderBy(sharelinks.createdAt);

  return Promise.all(rows.map(manageableSharelinkResponse));
}

/**
 * The cover each track shows, by track id, resolved through the same own →
 * collection → project chain the rest of the app uses. A guest cannot read
 * `/static` at all, so the share response carries the resolved cover and the
 * share's own image route serves the bytes.
 */
async function artworkByTrackId(trackIds: number[]) {
  const ids = [...new Set(trackIds)];
  if (ids.length === 0) return new Map<number, Artwork | null>();

  const rows = await db
    .select({
      id: tracks.id,
      artwork: artworkJsonFromPath(
        trackImagePathSql(tracks.image, tracks.id, tracks.projectId)
      ),
    })
    .from(tracks)
    .where(inArray(tracks.id, ids));

  return new Map(rows.map((row) => [row.id, row.artwork ?? null]));
}

async function withArtwork(
  trackList: SharelinkTrack[]
): Promise<SharelinkTrackWithArtwork[]> {
  const covers = await artworkByTrackId(
    trackList
      .map((track) => track.trackAudio.trackId)
      .filter((id) => id != null)
  );

  return trackList.map((track) => ({
    ...track,
    artwork:
      (track.trackAudio.trackId != null
        ? covers.get(track.trackAudio.trackId)
        : null) ?? null,
  }));
}

async function getSharelinkTracks(
  sharelink: Sharelink
): Promise<SharelinkTrackWithArtwork[]> {
  if (sharelink.shareType === "connected") {
    return withArtwork(
      await liveEntityTracks(sharelink.entityType, sharelink.entityId)
    );
  }

  const snapshotTracks = await db
    .select({
      id: sharelinkSnapshotTrackAudios.trackAudioId,
      position: sharelinkSnapshotTrackAudios.position,
      title: sharelinkSnapshotTrackAudios.title,
      artwork: artworkJsonFromPath(sharelinkSnapshotTrackAudios.image),
      trackAudio: {
        ...sharedTrackAudioColumns(),
        ...{
          name: assets.name,
          type: assets.type,
          size: assets.size,
          assetPath: assets.assetPath,
        },
      },
    })
    .from(sharelinkSnapshotTrackAudios)
    .leftJoin(
      trackAudios,
      eq(sharelinkSnapshotTrackAudios.trackAudioId, trackAudios.id)
    )
    .leftJoin(assets, eq(trackAudios.assetId, assets.id))
    .where(eq(sharelinkSnapshotTrackAudios.sharelinkId, sharelink.id))
    .orderBy(sharelinkSnapshotTrackAudios.position);

  // The cover comes from the path frozen into the row, not from the track,
  // which may have been re-covered since. A row with none had none when the
  // snapshot was taken.
  return snapshotTracks.map(({ artwork, ...track }) => ({
    ...nullsToUndefined(track),
    artwork: artwork ?? null,
  }));
}

/**
 * Confirms a track audio is one this link actually grants, so the stream and
 * comment routes cannot be pointed at an id from outside the shared entity by
 * a caller who only ever authenticated with the token.
 */
export async function resolveSharelinkTrackAudio(
  token: string,
  trackAudioId: number
) {
  const sharelink = await getSharelinkRow(token);
  const trackList = await getSharelinkTracks(sharelink);
  const track = trackList.find((t) => t.trackAudio.id === trackAudioId);
  if (!track) {
    throw new HTTPException(404, {
      message: "That track is not part of this share",
    });
  }
  return { sharelink, track };
}

/**
 * Every track audio that could be named in a snapshot override: any version
 * of the track (a track share) or of any track in the collection (a
 * collection share) — not just the primary, since overriding to a specific
 * non-primary version is the entire point of naming one explicitly.
 */
async function eligibleTrackAudios(
  entityType: SharelinkEntity,
  entityId: number
) {
  return db
    .select({
      trackAudioId: trackAudios.id,
      trackId: tracks.id,
      title: tracks.title,
      version: trackAudios.version,
      isPrimary: trackAudios.isPrimary,
      fileName: assets.name,
      position:
        entityType === "collection"
          ? sql<number | null>`(select ${collectionTracks.trackNumber}
              from ${collectionTracks}
              where ${collectionTracks.collectionId} = ${entityId}
                and ${collectionTracks.trackId} = ${tracks.id})`
          : sql<number | null>`null`,
    })
    .from(trackAudios)
    .innerJoin(tracks, eq(trackAudios.trackId, tracks.id))
    .leftJoin(assets, eq(trackAudios.assetId, assets.id))
    .where(
      entityType === "track"
        ? eq(tracks.id, entityId)
        : inArray(
            tracks.id,
            db
              .select({ id: collectionTracks.trackId })
              .from(collectionTracks)
              .where(eq(collectionTracks.collectionId, entityId))
          )
    );
}

export const shareOptionsSchema = z.array(
  z.object({
    id: z.number(),
    title: z.string().nullable(),
    position: z.number().nullable(),
    audios: z.array(
      z.object({
        id: z.number(),
        version: z.number(),
        isPrimary: z.boolean(),
        fileName: z.string().nullable(),
      })
    ),
  })
);

export type ShareOptions = z.infer<typeof shareOptionsSchema>;

/**
 * What a snapshot's track list can be built from: every track the entity
 * covers, in the order it plays, each carrying all of its versions. A picker
 * needs the versions the create and convert routes will accept, and nothing
 * else lists them — the collection's own audio route serves primaries only.
 */
export async function getShareOptions(
  entityType: SharelinkEntity,
  entityId: number,
  actorId: string
): Promise<ShareOptions> {
  await assertMayManage(entityType, entityId, actorId);

  const byTrack = new Map<number, ShareOptions[number]>();

  for (const row of await eligibleTrackAudios(entityType, entityId)) {
    let track = byTrack.get(row.trackId);
    if (!track) {
      track = {
        id: row.trackId,
        title: row.title,
        position: row.position,
        audios: [],
      };
      byTrack.set(row.trackId, track);
    }
    track.audios.push({
      id: row.trackAudioId,
      version: row.version,
      isPrimary: row.isPrimary,
      fileName: row.fileName,
    });
  }

  for (const track of byTrack.values()) {
    track.audios.sort((a, b) => b.version - a.version);
  }

  // An unnumbered track sits after the numbered ones rather than at the front,
  // which is where a null would otherwise sort.
  return [...byTrack.values()].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
  );
}

/**
 * What a guest sees one frozen track called. A name given for that track wins;
 * failing that, a track share takes the share's own title, since it holds a
 * single track and the two name the same thing — leaving the real one in place
 * would show it beside a title chosen to replace it. Only a collection share
 * falls through to the track's own name.
 */
function snapshotTrackTitle(
  sharelink: Sharelink,
  overrides: SnapshotOverrides,
  chosen: z.infer<typeof snapshotTrackSchema>,
  eligibleRow: { title: string | null }
): string | null {
  return (
    chosen.title?.trim() ||
    (sharelink.entityType === "track" ? overrides.title.trim() : "") ||
    eligibleRow.title
  );
}

/**
 * The cover each track resolves to right now, by track id, walking the same
 * own -> collection -> project chain the rest of the app uses.
 */
async function trackImagePaths(trackIds: number[]) {
  const ids = [...new Set(trackIds)];
  if (ids.length === 0) return new Map<number, string | null>();

  const rows = await db
    .select({
      id: tracks.id,
      image: sql<string | null>`${trackImagePathSql(
        tracks.image,
        tracks.id,
        tracks.projectId
      )}`,
    })
    .from(tracks)
    .where(inArray(tracks.id, ids));

  return new Map(rows.map((row) => [row.id, row.image]));
}

/**
 * Runs a snapshot write as one transaction. A pin of a version a duplicate
 * removal is deleting waits for that removal and then fails on the deleted
 * row; the whole transaction is run again, once, and reads the committed
 * state, so it answers what the request would have had the removal gone
 * first. A second removal beating the rerun too is answered as a conflict.
 */
async function inSnapshotTransaction<T>(
  write: (tx: Tx) => Promise<T>
): Promise<T> {
  try {
    return await db.transaction(write);
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
  }
  try {
    return await db.transaction(write);
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
    throw new HTTPException(409, {
      message:
        "The share's tracks changed while it was being saved. Try again.",
    });
  }
}

/**
 * Writes (or rewrites) the frozen track list a snapshot link serves. The
 * title, the running order and the cover are all copied in here rather than
 * resolved when a guest reads: a snapshot is a promise that what was shared
 * is what stays shared, so no later edit to the track can reach whoever holds
 * the link. The reads that choose the rows run outside `tx`; the writes are
 * the caller's transaction, so a link never commits with half a snapshot.
 */
async function writeSnapshot(
  tx: Tx,
  sharelink: Sharelink,
  overrides?: SnapshotOverrides
) {
  let rows: {
    trackAudioId: number;
    trackId: number;
    title: string | null;
    position: number;
  }[];

  if (overrides) {
    const eligible = new Map(
      (await eligibleTrackAudios(sharelink.entityType, sharelink.entityId)).map(
        (row) => [row.trackAudioId, row]
      )
    );

    rows = overrides.trackAudios.map((chosen, position) => {
      const eligibleRow = eligible.get(chosen.id);
      if (!eligibleRow) {
        throw new HTTPException(400, {
          message: `Track audio ${chosen.id} is not part of this ${sharelink.entityType}`,
        });
      }
      return {
        trackAudioId: chosen.id,
        trackId: eligibleRow.trackId,
        title: snapshotTrackTitle(sharelink, overrides, chosen, eligibleRow),
        position,
      };
    });
  } else {
    const liveTracks = await liveEntityTracks(
      sharelink.entityType,
      sharelink.entityId
    );
    rows = liveTracks.map((t, position) => ({
      trackAudioId: t.trackAudio.id!,
      trackId: t.trackAudio.trackId!,
      title: t.title ?? null,
      position: t.position ?? position,
    }));
  }

  if (rows.length === 0) {
    throw new HTTPException(400, {
      message: "No tracks to include in the snapshot",
    });
  }

  const covers = await trackImagePaths(rows.map((row) => row.trackId));

  // A blank title is "use the live one", not a blank heading on the share page.
  const title =
    overrides?.title ||
    (await liveEntityTitle(sharelink.entityType, sharelink.entityId));

  await tx
    .delete(sharelinkSnapshotTrackAudios)
    .where(eq(sharelinkSnapshotTrackAudios.sharelinkId, sharelink.id));

  // Ascending `trackAudioId` is the lock order of the pins (db.md, "Lock
  // order"); `position` carries the running order a guest sees.
  const pins = rows
    .toSorted((a, b) => a.trackAudioId - b.trackAudioId)
    .map((row) => ({
      trackAudioId: row.trackAudioId,
      sharelinkId: sharelink.id,
      title: row.title,
      image: covers.get(row.trackId) ?? null,
      position: row.position,
    }));
  await tx.insert(sharelinkSnapshotTrackAudios).values(pins);

  await tx
    .update(sharelinks)
    .set({ snapshotTitle: title ?? null })
    .where(eq(sharelinks.id, sharelink.id));
}

/** One version a snapshot freezes, and what a guest should see it called. */
const snapshotTrackSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().optional(),
});

const snapshotOverridesSchema = z.object({
  title: z.string(),
  trackAudios: z.array(snapshotTrackSchema),
});

type SnapshotOverrides = z.infer<typeof snapshotOverridesSchema>;

export const newShareRequestSchema = z.object({
  entityType: z.enum(SHARELINK_ENTITIES),
  entityId: z.number().int().positive(),
  expiresAt: z.coerce.date().optional(),
  description: z.string().optional(),
  privateComments: z.boolean().optional(),
  downloadsEnabled: z.boolean().optional(),
  snapshotOverrides: snapshotOverridesSchema.optional(),
});

export type NewShareRequest = z.infer<typeof newShareRequestSchema>;

export async function createSharelink(
  shareType: Sharelink["shareType"],
  input: NewShareRequest,
  actorId: string
) {
  if (shareType === "connected" && input.snapshotOverrides) {
    throw new HTTPException(400, {
      message: "snapshotOverrides is only accepted for a snapshot share",
    });
  }

  const projectId = await assertMayManage(
    input.entityType,
    input.entityId,
    actorId
  );
  // What the request leaves out, the project's sharing defaults fill; a link
  // the project lets live forever takes the column's far-future expiry.
  const { sharing } = await projectPolicy(projectId);
  const expiresAt =
    input.expiresAt ??
    (sharing.shareExpiresDays == null
      ? undefined
      : new Date(Date.now() + sharing.shareExpiresDays * DAY_MS));

  const token = randomBytes(9).toString("base64url");
  await inSnapshotTransaction(async (tx) => {
    const [sharelink] = await tx
      .insert(sharelinks)
      .values({
        token,
        entityType: input.entityType,
        entityId: input.entityId,
        shareType,
        ...(expiresAt && { expiresAt }),
        description: input.description,
        isCommentsPrivate:
          input.privateComments ?? sharing.shareCommentPrivacy === "private",
        isDownloadsEnabled: input.downloadsEnabled ?? sharing.shareDownloads,
      })
      .returning();
    if (!sharelink) {
      throw new HTTPException(500, { message: "Failed to create share link" });
    }

    if (shareType === "snapshot") {
      await writeSnapshot(tx, sharelink, input.snapshotOverrides);
    }
  });

  // Not `getSharelink`: that 410s an already-expired `expiresAt`, and a link
  // is allowed to be born expired (a share meant for a fixed window in the
  // past makes no sense, but nothing stops it, and the creator still needs to
  // see what they made).
  return buildSharelinkResponse(await findSharelinkRow(token));
}

export const editSharelinkSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  privateComments: z.boolean().optional(),
  downloadsEnabled: z.boolean().optional(),
});

export async function updateSharelink(
  token: string,
  actorId: string,
  patch: z.infer<typeof editSharelinkSchema>
) {
  const sharelink = await findSharelinkRow(token);
  await assertMayManageSharelink(sharelink, actorId);

  const [updated] = await db
    .update(sharelinks)
    .set({
      ...(patch.title !== undefined && { snapshotTitle: patch.title }),
      ...(patch.description !== undefined && {
        description: patch.description,
      }),
      ...(patch.expiresAt !== undefined && { expiresAt: patch.expiresAt }),
      ...(patch.privateComments !== undefined && {
        isCommentsPrivate: patch.privateComments,
      }),
      ...(patch.downloadsEnabled !== undefined && {
        isDownloadsEnabled: patch.downloadsEnabled,
      }),
    })
    .where(eq(sharelinks.id, sharelink.id))
    .returning();
  if (!updated) throw new HTTPException(404);

  return buildSharelinkResponse(updated);
}

export const updateSharelinkTracksSchema = z.object({
  title: z.string().optional(),
  trackAudios: z.array(snapshotTrackSchema).min(1),
});

/** Refreshes a snapshot's frozen track list and titles from the live entity. */
export async function updateSharelinkTracks(
  token: string,
  actorId: string,
  body: z.infer<typeof updateSharelinkTracksSchema>
) {
  const sharelink = await findSharelinkRow(token);
  await assertMayManageSharelink(sharelink, actorId);
  if (sharelink.shareType !== "snapshot") {
    throw new HTTPException(400, {
      message: "Only a snapshot share has a track list to update",
    });
  }

  await inSnapshotTransaction((tx) =>
    writeSnapshot(tx, sharelink, {
      title: body.title ?? sharelink.snapshotTitle ?? "",
      trackAudios: body.trackAudios,
    })
  );

  return buildSharelinkResponse(await findSharelinkRow(token));
}

export const convertSharelinkSchema = z.object({
  shareType: z.enum(SHARELINK_TYPES),
  snapshotOverrides: snapshotOverridesSchema.optional(),
});

/**
 * Snapshot -> connected just starts reading the live entity again. Connected
 * -> snapshot freezes it as of right now, the same way creating a fresh
 * snapshot link does.
 */
export async function convertSharelink(
  token: string,
  actorId: string,
  body: z.infer<typeof convertSharelinkSchema>
) {
  const sharelink = await findSharelinkRow(token);
  await assertMayManageSharelink(sharelink, actorId);

  if (body.shareType === sharelink.shareType) {
    return buildSharelinkResponse(sharelink);
  }

  await inSnapshotTransaction(async (tx) => {
    if (body.shareType === "snapshot") {
      await writeSnapshot(tx, sharelink, body.snapshotOverrides);
    } else {
      await tx
        .delete(sharelinkSnapshotTrackAudios)
        .where(eq(sharelinkSnapshotTrackAudios.sharelinkId, sharelink.id));
    }

    await tx
      .update(sharelinks)
      .set({ shareType: body.shareType })
      .where(eq(sharelinks.id, sharelink.id));
  });

  return buildSharelinkResponse(await findSharelinkRow(token));
}

/**
 * Turns a link off for good: the row stays, stamped, so a guest holding the
 * token is told it was turned off rather than that it never existed, and the
 * comments written through it stay. Revoking a link already revoked leaves
 * its first timestamp alone and succeeds.
 */
export async function revokeSharelink(token: string, actorId: string) {
  const sharelink = await readSharelinkRow(token);
  await assertMayManageSharelink(sharelink, actorId);

  await db
    .update(sharelinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(sharelinks.id, sharelink.id), isNull(sharelinks.revokedAt)));
}

export const newShareCommentSchema = z.object({
  trackAudioId: z.number().int().positive(),
  content: z.string().min(1),
  positionMs: z.number().int().nonnegative().optional(),
  parentId: z.number().int().positive().optional(),
});

export const editShareCommentSchema = z.object({
  content: z.string().min(1),
});

/**
 * Guest comments go through the same `comments` table and query layer as
 * every other timestamped audio comment — a track audio is already a comment
 * target (`COMMENT_TARGETS.track_audio`) — so they show up in the project's
 * normal comment feed for free. The only thing a share adds is the gate: the
 * token grants access to one track audio instead of project membership, and
 * the project has to take comments through its share links at all. A project
 * that does not refuses a new one with 403; the comments already there stay
 * readable, and their authors can still edit and delete them.
 */
export async function createShareComment(
  token: string,
  userId: string,
  body: z.infer<typeof newShareCommentSchema>
) {
  const { track } = await resolveSharelinkTrackAudio(token, body.trackAudioId);
  const projectId = await COMMENT_TARGETS.track_audio.projectIdFor(
    body.trackAudioId
  );
  if (projectId == null) throw new HTTPException(404);
  if (!(await projectPolicy(projectId)).sharing.guestComments) {
    throw new HTTPException(403, {
      message: "This project does not take comments through its share links",
    });
  }

  return createComment(
    {
      targetType: "track_audio",
      targetId: track.trackAudio.id!,
      content: body.content,
      positionMs: body.positionMs ?? null,
      parentId: body.parentId ?? null,
    },
    { userId, role: null },
    projectId
  );
}

/**
 * The gate on editing or deleting through a share: the comment has to be on a
 * track audio this token grants, so holding one link never reaches a thread on
 * another. Authorship is enforced by the comment queries themselves.
 */
async function assertShareComment(token: string, commentId: number) {
  const comment = await getCommentTarget(commentId);
  if (comment.targetType !== "track_audio") throw new HTTPException(404);
  await resolveSharelinkTrackAudio(token, comment.targetId);
}

export async function updateShareComment(
  token: string,
  userId: string,
  commentId: number,
  body: z.infer<typeof editShareCommentSchema>
) {
  await assertShareComment(token, commentId);
  return updateComment(
    commentId,
    { content: body.content },
    { userId, role: null }
  );
}

export async function deleteShareComment(
  token: string,
  userId: string,
  commentId: number
) {
  await assertShareComment(token, commentId);
  return deleteComment(commentId, userId);
}

/**
 * `isCommentsPrivate` narrows the thread to the reader's own conversation: a
 * top-level comment is visible only if they wrote it, and everything replying
 * to it stays visible so an answer from the team still reaches the person who
 * asked. A comment they did not write is never shown, and nor is anything
 * hanging off it.
 */
export async function getShareComments(
  token: string,
  trackAudioId: number,
  requesterId: string | null
) {
  const { sharelink } = await resolveSharelinkTrackAudio(token, trackAudioId);
  const thread = await getCommentsForTarget("track_audio", trackAudioId, {
    userId: requesterId,
    role: null,
  });
  if (!sharelink.isCommentsPrivate) return thread;
  if (requesterId == null) return [];

  return thread.filter((comment) => comment.user?.id === requesterId);
}
