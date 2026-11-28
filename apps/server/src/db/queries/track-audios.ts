import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  ANALYSIS_LOUDNESS,
  ANALYSIS_PEAKS,
  ANALYSIS_SPECTRUM,
} from "@workspace/dsp/analysis";
import {
  alignFeatures,
  ANALYSIS_OFFLINE,
  diffFeatures,
  FeatureSet,
  type Features,
} from "@workspace/dsp/offline";
import type { Dsp } from "@workspace/dsp/runtime";
import {
  spectrumEnvelope,
  type Spectrum,
  type SpectrumEnvelope,
} from "@workspace/dsp/spectrum";
import { ANALYSIS_VERSION } from "@workspace/dsp/version";
import {
  TRACK_AUDIO_MEASURES,
  type MeasureName,
} from "../../entities/track-audio/measures.js";
import { analyseAudioInWorker } from "../../lib/audio-analysis.js";
import { SECOND_MS } from "../../lib/duration.js";
import { errorFields, log } from "../../lib/log.js";
import { getDsp, isAudioName } from "../../lib/media.js";
import { writeSpectrogramPng } from "../../lib/spectrogram.js";
import {
  removeStoredFile,
  storedFileExists,
  withLocalStoredFile,
} from "../../lib/storage.js";
import { db, type Tx } from "../index.js";
import { z } from "zod";
import { assets, assetSchema } from "../schema/assets.js";
import { sessionAttachments, trackAttachments } from "../schema/attachments.js";
import { collectionTracks } from "../schema/collections.js";
import { type Job, type JobStep } from "../schema/jobs.js";
import { ROOT_NOTES, sessions } from "../schema/sessions.js";
import {
  trackAudioDiffs,
  trackAudioFeatures,
  type TrackAudioDiff,
} from "../schema/track-audio-analysis.js";
import {
  type BouncedFrom,
  silenceSchema,
  trackAudioLazyColumns,
  trackAudios,
  trackAudioWithAssetSchema,
  tracks,
} from "../schema/tracks.js";
import { artworkForTracks, artworkSchema } from "./artwork.js";
import { addUsage, scopesOf, subtractUsage } from "./storage-usage.js";
import type { ProjectResolution } from "./authorization.js";
import {
  enqueueJob,
  enqueueJobsOnce,
  labelsBySubject,
  registerJobHandler,
  type JobReporter,
} from "./jobs.js";
import { type ProjectPolicy, projectPolicy } from "./project-policy.js";

const logger = log("track-audios");

/**
 * Rewrites every `version` for a track so the set is dense and 1-based,
 * ordered by `COALESCE(assets.local_file_created_at, assets.created_at) ASC,
 * assets.id ASC`. `local_file_created_at` is only ever set by the scanner, so
 * browser uploads (where it is null) sort by upload time via `created_at`.
 *
 * `version` is `NOT NULL`, so it cannot be cleared to null between passes.
 * Negating every row first works instead: negatives never collide with the
 * positive values written next, so the `track_audio_version` unique
 * constraint holds at every step.
 */
async function resequenceVersions(tx: Tx, trackId: number) {
  await tx
    .update(trackAudios)
    .set({ version: sql`-${trackAudios.version}` })
    .where(eq(trackAudios.trackId, trackId));

  const rows = await tx
    .select({ id: trackAudios.id })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(eq(trackAudios.trackId, trackId))
    .orderBy(
      sql`COALESCE(${assets.localFileCreatedAt}, ${assets.createdAt}) ASC`,
      assets.id
    );

  if (rows.length === 0) return;

  // One statement for the whole track: raw SQL bypasses the `$onUpdate` hook
  // that a drizzle `update` would run, so `updated_at` is set here.
  await tx.execute(sql`
    update ${trackAudios} as ta
    set version = v.version, updated_at = now()
    from (values ${sql.join(
      rows.map((row, i) => sql`(${row.id}::int, ${i + 1}::int)`),
      sql`, `
    )}) as v(id, version)
    where ta.id = v.id
  `);
}

/**
 * Clears `is_primary` on every row for the track, then sets it on `audioId`.
 * `pinned` records whether a hand choice made it primary; an automatic
 * promotion passes false. `track_audios.one_primary_audio` is a partial unique
 * index (one `is_primary = true` per track), so a per-row clear-then-set is not
 * enough: flipping one row to `true` while the old primary still exists
 * violates the index even inside a transaction.
 */
export async function setPrimaryWithin(
  tx: Tx,
  trackId: number,
  audioId: number,
  pinned = false
) {
  await tx
    .update(trackAudios)
    .set({ isPrimary: false, primaryPinned: false })
    .where(eq(trackAudios.trackId, trackId));

  const [result] = await tx
    .update(trackAudios)
    .set({ isPrimary: true, primaryPinned: pinned })
    .where(eq(trackAudios.id, audioId))
    .returning();

  return result;
}

/** Resolver for `authorizeProject`: a track audio resolves through its track. */
export async function projectIdForTrackAudio(
  trackAudioId: number
): Promise<ProjectResolution> {
  if (Number.isNaN(trackAudioId)) return null;
  const [row] = await db
    .select({ projectId: tracks.projectId })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(eq(trackAudios.id, trackAudioId));
  if (!row) return null;
  return row.projectId;
}

/**
 * What the player shows beside an audio: the track it belongs to, the release
 * it sits on, and the artwork it tints its card from. It travels with the
 * audio so queueing a track costs the one request that starts playback rather
 * than a detail fetch and an image-list fetch per queued item.
 */
export const audioOwnerSchema = z.object({
  trackId: z.number(),
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  collectionId: z.number().nullable(),
  projectId: z.number().nullable(),
  artwork: artworkSchema.nullable(),
});

export type AudioOwner = z.infer<typeof audioOwnerSchema>;

/** The owner metadata for a set of tracks, keyed by track id. */
export async function audioOwnersForTracks(trackIds: number[]) {
  const owners = new Map<number, AudioOwner>();
  if (trackIds.length === 0) return owners;

  const rows = await db.query.tracks.findMany({
    where: { id: { in: [...new Set(trackIds)] } },
    columns: {
      id: true,
      title: true,
      artists: true,
      image: true,
      projectId: true,
    },
    with: { collections: { columns: { id: true, title: true, image: true } } },
  });

  const artwork = await artworkForTracks(rows);

  rows.forEach((row, i) => {
    const collection = row.collections[0];
    owners.set(row.id, {
      trackId: row.id,
      title: row.title,
      artists: row.artists,
      album: collection?.title ?? null,
      collectionId: collection?.id ?? null,
      projectId: row.projectId,
      artwork: artwork[i] ?? null,
    });
  });

  return owners;
}

export const trackAudioWithOwnerSchema = trackAudioWithAssetSchema.extend({
  owner: audioOwnerSchema.nullable(),
});

// Every lazy measure is served on its own through the measures route;
// carrying the biggest of them here would add ~90 KB per version to a
// list nothing reads them from.
const audioListColumns = trackAudioLazyColumns;

/**
 * Attaches each audio's owner. A version whose asset is gone is not something
 * a caller can play, so it does not appear in the list at all.
 */
function playableWithOwners<
  A extends { trackId: number; asset: object | null | undefined },
>(audios: A[], ownerOf: (trackId: number) => AudioOwner | null) {
  return audios
    .filter((audio) => audio.asset != null)
    .map((audio) => ({
      ...audio,
      asset: audio.asset!,
      owner: ownerOf(audio.trackId),
    }));
}

/**
 * For each save, the commit that recorded it or, when no commit recorded that
 * exact save, the first commit in the same session whose save was written at
 * or after it. A save no commit covers maps to a null commit.
 */
export async function bouncedFromOf(
  saveIds: number[]
): Promise<Map<number, BouncedFrom>> {
  const ids = [...new Set(saveIds)];
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<{
    save_id: number;
    session_id: number;
    saved_at: Date;
    commit_id: number | null;
    message: string | null;
    committed_at: Date | null;
    branch: string | null;
    kind: NonNullable<BouncedFrom["commit"]>["kind"] | null;
  }>(sql`
    -- A raw read skips drizzle's decoding: the columns are timestamps without
    -- a zone holding UTC, which the driver would parse as the process's local
    -- time. Reading them at time zone 'UTC' hands it an instant instead.
    select s.id as save_id, s.session_id,
      s.file_updated_at at time zone 'UTC' as saved_at,
      c.id as commit_id, c.message, c.committed_at at time zone 'UTC' as committed_at,
      b.name as branch, c.kind
    from saves s
    left join lateral (
      select c.* from commits c
      join saves cs on cs.id = c.save_id
      where c.session_id = s.session_id
        and (c.save_id = s.id or cs.file_updated_at >= s.file_updated_at)
      order by (c.save_id = s.id) desc, cs.file_updated_at asc
      limit 1
    ) c on true
    left join branches b on b.id = c.branch_id
    where s.id in (${sql.join(ids, sql`, `)})
  `);
  return new Map(
    rows.map((row): [number, BouncedFrom] => {
      const { commit_id, message, committed_at, branch, kind } = row;
      const commit =
        commit_id === null ||
        message === null ||
        committed_at === null ||
        branch === null ||
        kind === null
          ? null
          : {
              id: commit_id,
              message,
              committedAt: new Date(committed_at),
              branch,
              kind,
            };
      return [
        row.save_id,
        {
          saveId: row.save_id,
          sessionId: row.session_id,
          savedAt: new Date(row.saved_at),
          commit,
        },
      ];
    })
  );
}

/**
 * Attaches each version's bounce: the save it was rendered from and the commit
 * that recorded it. A version never bounced from a save carries null.
 */
export async function withBouncedFrom<
  A extends { bouncedFromSaveId: number | null },
>(audios: A[]) {
  const bounced = await bouncedFromOf(
    audios.flatMap((a) =>
      a.bouncedFromSaveId === null ? [] : [a.bouncedFromSaveId]
    )
  );
  return audios.map((audio) => ({
    ...audio,
    bouncedFrom:
      audio.bouncedFromSaveId === null
        ? null
        : (bounced.get(audio.bouncedFromSaveId) ?? null),
  }));
}

export async function getTrackAudios(trackId: number) {
  const [audios, owners] = await Promise.all([
    db.query.trackAudios.findMany({
      where: { trackId },
      columns: audioListColumns,
      with: { asset: true },
      orderBy: { version: "asc" },
    }),
    audioOwnersForTracks([trackId]),
  ]);

  return playableWithOwners(
    await withBouncedFrom(audios),
    () => owners.get(trackId) ?? null
  );
}

/**
 * The audios linked to a project's live tracks at or after `since`, newest
 * linked first, at most `limit` of them. The cap applies before rows whose
 * asset is gone are dropped, as `getTrackAudios` drops them. `total` counts
 * every linked audio at or after `since`, past the cap and before that drop.
 */
export async function getRecentTrackAudios(
  projectId: number,
  since: Date,
  limit: number
) {
  const recent = await db
    .select({
      id: trackAudios.id,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(
      and(
        eq(tracks.projectId, projectId),
        isNull(tracks.archivedAt),
        gte(trackAudios.createdAt, since)
      )
    )
    .orderBy(desc(trackAudios.createdAt), desc(trackAudios.id))
    .limit(limit);
  if (recent.length === 0) return { audios: [], total: 0 };

  const total = recent[0]?.total ?? 0;
  const ids = recent.map((row) => row.id);
  const audios = await db.query.trackAudios.findMany({
    where: { id: { in: ids } },
    columns: audioListColumns,
    with: { asset: true },
  });
  const byId = new Map(audios.map((audio) => [audio.id, audio]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  const owners = await audioOwnersForTracks(ordered.map((a) => a.trackId));

  return {
    audios: playableWithOwners(
      await withBouncedFrom(ordered),
      (id) => owners.get(id) ?? null
    ),
    total,
  };
}

/**
 * Narrows a set of asset ids to the ones whose file name is audio, keeping the
 * caller's order. A `track_audios` row is a version of the track, so an image
 * or a document must never become one.
 */
async function filterToAudioAssets(assetIds: number[]) {
  if (assetIds.length === 0) return [];

  const rows = await db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(inArray(assets.id, assetIds));

  const audio = new Set(
    rows.filter((row) => isAudioName(row.name)).map((row) => row.id)
  );
  return assetIds.filter((id) => audio.has(id));
}

/** A track's audio versions, each with its owner metadata — the shape `GET /tracks/:id/audios` sends. */
export const trackAudiosSchema = z.array(trackAudioWithOwnerSchema);

/** What `linkTrackAudios` returns, and what `POST /tracks/:id/audios` sends back. */
export const linkTrackAudiosResultSchema = z.object({
  audios: trackAudiosSchema,
  analysisJobIds: z.array(z.number()),
});

/** The assets `linkTrackAudios` links, and the one of them to make primary. */
export const linkTrackAudiosBodySchema = z
  .object({
    assetIds: z.array(z.number()),
    primaryAssetId: z.number().optional(),
  })
  .refine(
    (body) =>
      body.primaryAssetId === undefined ||
      body.assetIds.includes(body.primaryAssetId),
    {
      message: "primaryAssetId must be one of assetIds",
      path: ["primaryAssetId"],
    }
  );

/** Whether the project `trackId` belongs to analyses a version as soon as it is linked. */
async function analysesOnLink(trackId: number): Promise<boolean> {
  const [track] = await db
    .select({ projectId: tracks.projectId })
    .from(tracks)
    .where(eq(tracks.id, trackId));
  return (
    track != null && (await projectPolicy(track.projectId)).audio.autoAnalyse
  );
}

/**
 * Links audio asset ids to a track inside a caller-owned transaction,
 * resequences versions, and updates the primary version. Callers must invoke
 * {@link enqueueLinkedAnalysis} after the transaction commits.
 */
export async function linkTrackAudiosWithin(
  tx: Tx,
  trackId: number,
  audioIds: number[],
  primaryAssetId?: number
): Promise<{ id: number }[]> {
  // The assets first, then the track's lock, both before the insert
  // (`docs/agents/db.md`, Lock order). The insert key-share-locks each
  // asset and the track's row through its foreign keys; a track delete
  // holds the track's lock while it deletes that row, so a link that had
  // the row first and then waited on the lock would deadlock against it.
  await tx
    .select({ id: assets.id })
    .from(assets)
    .where(inArray(assets.id, audioIds))
    .orderBy(assets.id)
    .for("key share");
  await lockTracksForAnalysis(tx, [trackId]);

  const hadPrimary = await tx.query.trackAudios.findFirst({
    where: { trackId, isPrimary: true },
    columns: { id: true, primaryPinned: true },
  });

  // Insert past the current max version so the whole set stays positive and
  // distinct; resequenceVersions then renumbers everything by asset date.
  const versionRows = await tx
    .select({
      maxVersion: sql<number>`COALESCE(MAX(${trackAudios.version}), 0)`,
    })
    .from(trackAudios)
    .where(eq(trackAudios.trackId, trackId));
  const maxVersion = versionRows[0]?.maxVersion ?? 0;

  const rows = await tx
    .insert(trackAudios)
    .values(
      audioIds.map((assetId, i) => ({
        trackId,
        assetId,
        version: maxVersion + 1 + i,
      }))
    )
    .onConflictDoNothing({
      target: [trackAudios.trackId, trackAudios.assetId],
    })
    .returning({ id: trackAudios.id });

  await resequenceVersions(tx, trackId);

  if (primaryAssetId !== undefined) {
    const [row] = await tx
      .select({ id: trackAudios.id })
      .from(trackAudios)
      .where(
        and(
          eq(trackAudios.trackId, trackId),
          eq(trackAudios.assetId, primaryAssetId)
        )
      );
    if (row) await setPrimaryWithin(tx, trackId, row.id, true);
  } else if (!hadPrimary || !hadPrimary.primaryPinned) {
    const [newest] = await tx
      .select({ id: trackAudios.id })
      .from(trackAudios)
      .where(eq(trackAudios.trackId, trackId))
      .orderBy(sql`${trackAudios.version} DESC`)
      .limit(1);
    if (newest) await setPrimaryWithin(tx, trackId, newest.id);
  }

  return rows;
}

/** Queues analysis for newly linked track-audio rows once their transaction has committed. */
export async function enqueueLinkedAnalysis(
  trackId: number,
  inserted: { id: number }[]
): Promise<number[]> {
  if (inserted.length === 0) return [];
  const jobs = (await analysesOnLink(trackId))
    ? await enqueueAudioAnalysis(inserted.map((row) => row.id))
    : [];
  return jobs.map((job) => job.id);
}

/**
 * Links assets to a track as audios. Ids that are not audio files are dropped,
 * so the returned list is the authority on what was linked. Idempotent: an
 * asset already linked is left untouched via `onConflictDoNothing` on
 * `track_audio_asset`. After linking, the track's versions are resequenced. If
 * `primaryAssetId` is given it becomes the primary; otherwise, if the track had
 * no primary, the newest linked row (highest version) becomes primary.
 *
 * Alongside the resulting audios, this returns the ids of the `audio_analysis`
 * jobs it queued for the newly linked rows, so a caller can follow them
 * without a second read; none where the project does not analyse
 * automatically.
 */
export async function linkTrackAudios(
  trackId: number,
  assetIds: number[],
  primaryAssetId?: number
): Promise<{
  audios: Awaited<ReturnType<typeof getTrackAudios>>;
  analysisJobIds: number[];
}> {
  const audioIds = await filterToAudioAssets(assetIds);
  if (audioIds.length === 0)
    return { audios: await getTrackAudios(trackId), analysisJobIds: [] };

  const inserted = await db.transaction((tx) =>
    linkTrackAudiosWithin(tx, trackId, audioIds, primaryAssetId)
  );

  // Enqueued after the commit so the background pass can read the rows. A
  // project that does not analyse automatically queues nothing here: its new
  // versions wait until someone asks for their analysis.
  const analysisJobIds = await enqueueLinkedAnalysis(trackId, inserted);

  return {
    audios: await getTrackAudios(trackId),
    analysisJobIds,
  };
}

export async function unlinkTrackAudio(id: number) {
  const owner = await db.query.trackAudios.findFirst({
    where: { id },
    columns: { trackId: true },
    with: { track: { columns: { projectId: true } } },
  });
  if (!owner) return undefined;

  // Locked the same way a fresh analysis is: deleting a version that was
  // standing between two others can leave the cascade taking their diff row
  // with it, and the repair below reads the track's other current versions
  // the same way a concurrent analysis would.
  const deleted = await withTrackAnalysisLock(owner.trackId, async (tx) => {
    const [deleted] = await tx
      .delete(trackAudios)
      .where(eq(trackAudios.id, id))
      .returning();
    if (!deleted) return undefined;

    await closeVersionGaps(tx, [deleted]);

    if (deleted.spectrogramBytes > 0) {
      await subtractUsage(
        tx,
        scopesOf({ projectId: owner.track?.projectId }),
        deleted.spectrogramBytes
      );
    }

    return deleted;
  });

  // Unlinked after the row (and its diffs and features, cascaded) are
  // committed gone, so a crash between the two leaves an orphan file rather
  // than a broken row pointing at nothing.
  if (deleted?.spectrogramKey) await removeStoredFile(deleted.spectrogramKey);

  return deleted;
}

/**
 * Every stored spectrogram key for the given asset's track-audio row(s), read
 * before a caller's cascading delete of the asset removes the rows that name
 * them. The caller removes the files once its own delete has committed.
 */
export async function spectrogramKeysForAsset(
  assetId: number
): Promise<string[]> {
  const rows = await db
    .select({ key: trackAudios.spectrogramKey })
    .from(trackAudios)
    .where(eq(trackAudios.assetId, assetId));
  return rows.flatMap((row) => (row.key ? [row.key] : []));
}

/**
 * Every stored spectrogram key for the track-audio rows of the tracks
 * `tracksWhere` matches, read before a caller's cascading delete of those
 * tracks (one, several, or a whole project's worth) removes the rows that
 * name them. The caller removes the files once its own delete has committed.
 */
export async function spectrogramKeysForTracksMatching(
  tracksWhere: SQL | undefined
): Promise<string[]> {
  const rows = await db
    .select({ key: trackAudios.spectrogramKey })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(tracksWhere);
  return rows.flatMap((row) => (row.key ? [row.key] : []));
}

export async function setPrimaryTrackAudio(id: number) {
  return db.transaction(async (tx) => {
    const audio = await tx.query.trackAudios.findFirst({
      where: { id },
      columns: { trackId: true },
    });
    if (!audio) return undefined;

    await lockTracksForAnalysis(tx, [audio.trackId]);
    // A delete holding the lock may have removed the version while this
    // waited; clearing the track's primaries then would leave it with none.
    const stillThere = await tx.query.trackAudios.findFirst({
      where: { id, trackId: audio.trackId },
      columns: { id: true },
    });
    if (!stillThere) return undefined;
    return setPrimaryWithin(tx, audio.trackId, id, true);
  });
}

/**
 * Clears `primaryPinned` on the track's versions and promotes the newest
 * version to primary so the track resumes following the latest bounce.
 */
export async function unpinPrimaryTrackAudio(id: number) {
  return db.transaction(async (tx) => {
    const audio = await tx.query.trackAudios.findFirst({
      where: { id },
      columns: { trackId: true },
    });
    if (!audio) return undefined;

    await lockTracksForAnalysis(tx, [audio.trackId]);
    const stillThere = await tx.query.trackAudios.findFirst({
      where: { id, trackId: audio.trackId },
      columns: { id: true },
    });
    if (!stillThere) return undefined;

    const [newest] = await tx
      .select({ id: trackAudios.id })
      .from(trackAudios)
      .where(eq(trackAudios.trackId, audio.trackId))
      .orderBy(sql`${trackAudios.version} DESC`)
      .limit(1);
    if (!newest) return undefined;
    return setPrimaryWithin(tx, audio.trackId, newest.id, false);
  });
}

/** A candidate audio asset, extended with the `track_audios` row it is already linked as, or null. */
export const candidateAudioSchema = assetSchema.extend({
  trackAudio: z
    .object({
      id: z.number(),
      version: z.number(),
      isPrimary: z.boolean(),
    })
    .nullable(),
});

/**
 * Every audio asset that could be a version of this track: the track's own
 * attachments plus the attachments of every session pointing at it, deduped
 * by asset id and filtered to audio by file extension. Each row carries the
 * matching `track_audios` row (or null) so the manage dialog can show what is
 * already linked rather than hiding it.
 */
export async function getCandidateAudios(trackId: number) {
  const trackAssetIds = db
    .select({ assetId: trackAttachments.assetId })
    .from(trackAttachments)
    .where(eq(trackAttachments.trackId, trackId));

  const sessionAssetIds = db
    .select({ assetId: sessionAttachments.assetId })
    .from(sessionAttachments)
    .innerJoin(sessions, eq(sessions.id, sessionAttachments.sessionId))
    .where(eq(sessions.trackId, trackId));

  const rows = await db
    .select({
      asset: assets,
      trackAudio: {
        id: trackAudios.id,
        version: trackAudios.version,
        isPrimary: trackAudios.isPrimary,
      },
    })
    .from(assets)
    .leftJoin(
      trackAudios,
      and(eq(trackAudios.assetId, assets.id), eq(trackAudios.trackId, trackId))
    )
    .where(sql`${assets.id} IN (${trackAssetIds} UNION ${sessionAssetIds})`)
    .orderBy(
      sql`COALESCE(${assets.localFileCreatedAt}, ${assets.createdAt}) DESC`,
      assets.id
    );

  const seen = new Set<number>();
  const result = [];
  for (const r of rows) {
    if (seen.has(r.asset.id) || !isAudioName(r.asset.name)) continue;
    seen.add(r.asset.id);
    result.push({
      ...r.asset,
      trackAudio: r.trackAudio?.id ? r.trackAudio : null,
    });
  }
  return result;
}

/**
 * Every flag a decode runs: peaks, loudness and the long-term average
 * spectrum alongside the whole offline set (tempo, key, sections, the
 * spectrogram tile, the loudness and correlation curves, clipping, silence,
 * the pitch track and the quantised features a diff or a duplicate check
 * reads back).
 */
const ANALYSIS_FLAGS =
  ANALYSIS_PEAKS | ANALYSIS_LOUDNESS | ANALYSIS_SPECTRUM | ANALYSIS_OFFLINE;

/**
 * A track audio's analysis has fallen behind the package's current
 * `ANALYSIS_VERSION` — the one rule for "not yet analysed", read by every
 * lazy reader, the `audio_backfill` finder and the boot-time queue.
 */
const outstandingAnalysis = or(
  isNull(trackAudios.analysisVersion),
  lt(trackAudios.analysisVersion, ANALYSIS_VERSION)
);

/** The same rule as {@link outstandingAnalysis}, for a version already read into memory. */
function isOutstandingAnalysis(analysisVersion: number | null): boolean {
  return analysisVersion == null || analysisVersion < ANALYSIS_VERSION;
}

/**
 * One version of a track's audio, and everything an audit reasons over: the
 * asset it points at, the sessions that asset is attached to (each carrying
 * whether that session belongs to the same track as this version), whether
 * the stored file is still on disk, and its measured content. Never carries
 * `audioPeaks`/`ltas` — an audit reads facts about a version, not its
 * waveform.
 */
export const auditVersionSchema = z.object({
  id: z.number(),
  version: z.number(),
  isPrimary: z.boolean(),
  primaryPinned: z.boolean(),
  asset: z.object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    size: z.number(),
    fingerprint: z.string().nullable(),
    localFilepath: z.string().nullable(),
    createdAt: z.date(),
  }),
  sessions: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      linkedToThisTrack: z.boolean(),
    })
  ),
  fileExists: z.boolean(),
  analysis: z.object({
    current: z.boolean(),
    durationMs: z.number().nullable(),
    lufs: z.number().nullable(),
    lra: z.number().nullable(),
    truePeakDb: z.number().nullable(),
    silence: silenceSchema.nullable(),
    /** Number of 50 ms bins that clipped. */
    clippedBins: z.number(),
    /** Total full-scale frames across every clipped bin. */
    clippedFrames: z.number(),
    /** Number of clipped bins whose true peak passed 0 dBTP. */
    clippedOverBins: z.number(),
    bpm: z.number().nullable(),
    bpmConfidence: z.number().nullable(),
    musicalKey: z.string().nullable(),
    keyConfidence: z.number().nullable(),
    /** The lowest-numbered other current version of this track this one's fingerprint duplicates. */
    duplicateOfId: z.number().nullable(),
  }),
});
export type AuditVersion = z.infer<typeof auditVersionSchema>;

/** One project track's audio versions, plus session-attached assets it could adopt but hasn't. */
export const auditTrackSchema = z.object({
  trackId: z.number(),
  title: z.string(),
  versions: z.array(auditVersionSchema),
  unlinkedCandidates: z.array(
    z.object({ assetId: z.number(), name: z.string() })
  ),
});
export type AuditTrack = z.infer<typeof auditTrackSchema>;

/**
 * Every code a finding can carry, one entry per row `audioFindings` knows
 * how to raise. The one place a new finding code is declared.
 */
export const FINDING_CODES = [
  "missing_file",
  "analysis_outstanding",
  "no_audio",
  "no_primary",
  "stale_primary",
  "unlinked_candidate",
  "duplicate_across_tracks",
  "name_mismatch",
  "too_short",
  "near_silent",
  "hot_peak",
  "long_silence_lead",
  "long_silence_tail",
  "clipping",
  "duplicate_version",
] as const;

/** The tool the model can call to act on a finding, when one exists. */
export const FINDING_FIXES = [
  "queue_analysis",
  "set_primary_audio",
  "link_audio_versions",
  "unlink_audio_version",
] as const;

/** A finding's stable identity: what went wrong, at what severity, and the tool that can fix it. */
export const findingSchema = z.object({
  code: z.enum(FINDING_CODES),
  severity: z.enum(["error", "warn", "info"]),
  trackId: z.number(),
  trackAudioId: z.number().optional(),
  message: z.string(),
  fix: z.enum(FINDING_FIXES).optional(),
});
export type Finding = z.infer<typeof findingSchema>;

/** The facts {@link audioFindings} reasons over, plus the findings themselves. */
export const audioAuditSchema = z.object({
  tracks: z.array(auditTrackSchema),
  duplicateFingerprints: z.array(
    z.object({ fingerprint: z.string(), trackIds: z.array(z.number()) })
  ),
  findings: z.array(findingSchema),
});
export type AudioAudit = z.infer<typeof audioAuditSchema>;

/**
 * Every fact a project's audio audit reasons over, gathered in three
 * statements: each track's versions joined to their asset and to `tracks`
 * for the title; the sessions those assets are attached to, so a version can
 * say which of its sessions belong to its own track; and the asset
 * fingerprints shared across more than one track, project-wide regardless of
 * `trackIds`, since a duplicate spans whatever tracks hold it. A track with
 * no version at all is a fourth cheap select over the same scope, and
 * `fileExists` runs {@link storedFileExists} for every version in parallel
 * rather than one at a time.
 *
 * `trackIds`, when given, pages the read to that subset of the project's
 * tracks — the whole-catalogue read a large project would otherwise force.
 */
export async function auditProjectAudio(
  projectId: number,
  trackIds?: number[]
): Promise<Omit<AudioAudit, "findings">> {
  const scope = and(
    eq(tracks.projectId, projectId),
    trackIds && trackIds.length > 0 ? inArray(tracks.id, trackIds) : undefined
  );

  const versionRows = await db
    .select({
      id: trackAudios.id,
      trackId: trackAudios.trackId,
      trackTitle: tracks.title,
      version: trackAudios.version,
      isPrimary: trackAudios.isPrimary,
      primaryPinned: trackAudios.primaryPinned,
      durationMs: trackAudios.durationMs,
      lufs: trackAudios.lufs,
      lra: trackAudios.lra,
      truePeakDb: trackAudios.truePeakDb,
      analysisVersion: trackAudios.analysisVersion,
      silence: trackAudios.silence,
      bpm: trackAudios.bpm,
      bpmConfidence: trackAudios.bpmConfidence,
      musicalKey: trackAudios.musicalKey,
      keyConfidence: trackAudios.keyConfidence,
      duplicateOfId: trackAudios.duplicateOfId,
      // `clipping` is a lazy column (LAZY_TRACK_AUDIO_COLUMNS) — the array
      // itself is never selected here, only what the audit needs computed in
      // SQL: how many bins clipped, how many full-scale frames they cover in
      // total, and how many of them also passed 0 dBTP.
      clippedBins:
        sql<number>`coalesce(jsonb_array_length(${trackAudios.clipping}), 0)`.mapWith(
          Number
        ),
      clippedFrames: sql<number>`coalesce((
        select sum((elem->>'samples')::int)
        from jsonb_array_elements(coalesce(${trackAudios.clipping}, '[]'::jsonb)) as elem
      ), 0)`.mapWith(Number),
      clippedOverBins: sql<number>`coalesce((
        select count(*)
        from jsonb_array_elements(coalesce(${trackAudios.clipping}, '[]'::jsonb)) as elem
        where (elem->>'over')::boolean
      ), 0)`.mapWith(Number),
      assetId: assets.id,
      assetName: assets.name,
      assetType: assets.type,
      assetSize: assets.size,
      assetFingerprint: assets.fingerprint,
      assetLocalFilepath: assets.localFilepath,
      assetCreatedAt: assets.createdAt,
      assetPath: assets.assetPath,
    })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(scope)
    .orderBy(trackAudios.trackId, trackAudios.version);

  const assetIds = [...new Set(versionRows.map((row) => row.assetId))];
  const versionedTrackIds = [...new Set(versionRows.map((row) => row.trackId))];

  const [
    fileExists,
    sessionRows,
    duplicateRows,
    unversionedTracks,
    sessionTracks,
  ] = await Promise.all([
    Promise.all(versionRows.map((row) => storedFileExists(row.assetPath))),
    assetIds.length === 0
      ? []
      : db
          .select({
            assetId: sessionAttachments.assetId,
            sessionId: sessions.id,
            sessionName: sessions.name,
            sessionTrackId: sessions.trackId,
          })
          .from(sessionAttachments)
          .innerJoin(sessions, eq(sessions.id, sessionAttachments.sessionId))
          .where(inArray(sessionAttachments.assetId, assetIds)),
    db
      .select({
        fingerprint: assets.fingerprint,
        trackIds: sql<number[]>`array_agg(distinct ${trackAudios.trackId})`,
      })
      .from(assets)
      .innerJoin(trackAudios, eq(trackAudios.assetId, assets.id))
      .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
      .where(
        and(eq(tracks.projectId, projectId), isNotNull(assets.fingerprint))
      )
      .groupBy(assets.fingerprint)
      .having(sql`count(distinct ${trackAudios.trackId}) > 1`),
    db
      .select({ id: tracks.id, title: tracks.title })
      .from(tracks)
      .where(and(scope, notInArray(tracks.id, versionedTrackIds))),
    // Which of the scope's tracks have a session at all, so the candidate
    // fan-out below only runs for tracks a session attachment could name.
    db
      .select({ trackId: sessions.trackId })
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, projectId),
          isNotNull(sessions.trackId),
          trackIds && trackIds.length > 0
            ? inArray(sessions.trackId, trackIds)
            : undefined
        )
      ),
  ]);

  const sessionsByAsset = new Map<number, typeof sessionRows>();
  for (const row of sessionRows) {
    if (row.assetId == null) continue;
    const list = sessionsByAsset.get(row.assetId) ?? [];
    list.push(row);
    sessionsByAsset.set(row.assetId, list);
  }

  const versionsByTrack = new Map<number, AuditVersion[]>();
  versionRows.forEach((row, index) => {
    const list = versionsByTrack.get(row.trackId) ?? [];
    list.push({
      id: row.id,
      version: row.version,
      isPrimary: row.isPrimary,
      primaryPinned: row.primaryPinned,
      asset: {
        id: row.assetId,
        name: row.assetName,
        type: row.assetType,
        size: row.assetSize,
        fingerprint: row.assetFingerprint,
        localFilepath: row.assetLocalFilepath,
        createdAt: row.assetCreatedAt,
      },
      sessions: (sessionsByAsset.get(row.assetId) ?? []).map((session) => ({
        id: session.sessionId,
        name: session.sessionName,
        linkedToThisTrack: session.sessionTrackId === row.trackId,
      })),
      fileExists: fileExists[index]!,
      analysis: {
        current: !isOutstandingAnalysis(row.analysisVersion),
        durationMs: row.durationMs,
        lufs: row.lufs,
        lra: row.lra,
        truePeakDb: row.truePeakDb,
        silence: row.silence,
        clippedBins: row.clippedBins,
        clippedFrames: row.clippedFrames,
        clippedOverBins: row.clippedOverBins,
        bpm: row.bpm,
        bpmConfidence: row.bpmConfidence,
        musicalKey: row.musicalKey,
        keyConfidence: row.keyConfidence,
        duplicateOfId: row.duplicateOfId,
      },
    });
    versionsByTrack.set(row.trackId, list);
  });

  const titles = new Map<number, string>();
  for (const row of versionRows) titles.set(row.trackId, row.trackTitle);
  for (const row of unversionedTracks) titles.set(row.id, row.title);

  const tracksWithSessions = new Set(
    sessionTracks
      .map((row) => row.trackId)
      .filter((trackId): trackId is number => trackId != null)
  );

  // An unlinked candidate almost always arrives as a session recording, not
  // a direct track attachment — a scanner import attaches raw takes to the
  // session it found them in, and a track's own attachments are usually
  // versions already. Calling `getCandidateAudios` only for tracks that have
  // a session trades that rare miss for not fanning it out across every
  // track in a project that has none.
  const candidateEntries = await Promise.all(
    [...titles.keys()]
      .filter((trackId) => tracksWithSessions.has(trackId))
      .map(
        async (trackId) => [trackId, await getCandidateAudios(trackId)] as const
      )
  );
  const candidatesByTrack = new Map(candidateEntries);

  const auditTracks: AuditTrack[] = [...titles.keys()]
    .sort((a, b) => a - b)
    .map((trackId) => ({
      trackId,
      title: titles.get(trackId)!,
      versions: versionsByTrack.get(trackId) ?? [],
      unlinkedCandidates: (candidatesByTrack.get(trackId) ?? [])
        .filter((candidate) => candidate.trackAudio == null)
        .map((candidate) => ({ assetId: candidate.id, name: candidate.name })),
    }));

  const duplicateFingerprints = duplicateRows.map((row) => ({
    fingerprint: row.fingerprint!,
    trackIds: row.trackIds,
  }));

  return { tracks: auditTracks, duplicateFingerprints };
}

/** The project's thresholds `audioFindings` measures content findings against. */
export type AuditThresholds = Pick<
  ProjectPolicy["audio"],
  | "auditTooShortSeconds"
  | "auditNearSilentLufs"
  | "auditHotPeakDbtp"
  | "auditLeadSilenceSeconds"
  | "auditTailSilenceSeconds"
  | "auditNameMismatch"
>;

/** A crude token overlap between an asset name and a title, both lower-cased with separators removed. */
export function nameSimilarity(assetName: string, title: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/\.[a-z0-9]{1,8}$/, "")
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1)
    );
  const a = tokens(assetName);
  const b = tokens(title);
  if (a.size === 0 || b.size === 0) return 1; // nothing to compare is not a mismatch
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Turns an {@link AudioAudit}'s facts into the sentences the model reasons
 * over: file and analysis integrity first, then track-to-audio consistency,
 * then content anomalies from the stored duration, loudness and true peak,
 * each measured against the project's `thresholds`. `name_mismatch` fires
 * only when a version's file name reads like another track's title better
 * than its own.
 */
export function audioFindings(
  audit: Omit<AudioAudit, "findings">,
  thresholds: AuditThresholds
): Finding[] {
  const out: Finding[] = [];
  const titles = new Map(audit.tracks.map((t) => [t.trackId, t.title]));

  for (const track of audit.tracks) {
    const { trackId, title, versions } = track;
    if (versions.length === 0) {
      out.push({
        code: "no_audio",
        severity: "info",
        trackId,
        message: `"${title}" has no audio version.`,
        fix: track.unlinkedCandidates.length
          ? "link_audio_versions"
          : undefined,
      });
    }
    if (versions.length > 0 && !versions.some((v) => v.isPrimary)) {
      out.push({
        code: "no_primary",
        severity: "warn",
        trackId,
        message: `"${title}" has ${versions.length} versions and no primary.`,
        fix: "set_primary_audio",
      });
    }
    const newest = versions.at(-1);
    const primary = versions.find((v) => v.isPrimary);
    if (
      newest &&
      primary &&
      newest.id !== primary.id &&
      !primary.primaryPinned
    ) {
      out.push({
        code: "stale_primary",
        severity: "info",
        trackId,
        trackAudioId: newest.id,
        message: `"${title}": the primary is v${primary.version}; v${newest.version} (${newest.asset.name}) is newer.`,
        fix: "set_primary_audio",
      });
    }
    for (const c of track.unlinkedCandidates) {
      out.push({
        code: "unlinked_candidate",
        severity: "info",
        trackId,
        message: `"${title}": ${c.name} is attached to one of its sessions but is not a version.`,
        fix: "link_audio_versions",
      });
    }
    for (const v of versions) {
      const label = `"${title}" v${v.version} (${v.asset.name})`;
      if (!v.fileExists) {
        out.push({
          code: "missing_file",
          severity: "error",
          trackId,
          trackAudioId: v.id,
          message: `${label}: the stored file is gone.`,
          fix: "unlink_audio_version",
        });
        continue;
      }
      if (!v.analysis.current) {
        out.push({
          code: "analysis_outstanding",
          severity: "warn",
          trackId,
          trackAudioId: v.id,
          message: `${label}: not analysed yet.`,
          fix: "queue_analysis",
        });
        continue;
      }
      const {
        durationMs,
        lufs,
        truePeakDb,
        silence,
        clippedBins,
        clippedFrames,
        clippedOverBins,
        duplicateOfId,
      } = v.analysis;
      if (
        durationMs != null &&
        durationMs < thresholds.auditTooShortSeconds * SECOND_MS
      ) {
        out.push({
          code: "too_short",
          severity: "warn",
          trackId,
          trackAudioId: v.id,
          message: `${label}: only ${(durationMs / 1000).toFixed(1)} s long.`,
        });
      }
      if (lufs != null && lufs < thresholds.auditNearSilentLufs) {
        out.push({
          code: "near_silent",
          severity: "warn",
          trackId,
          trackAudioId: v.id,
          message: `${label}: ${lufs.toFixed(1)} LUFS integrated, near silent.`,
        });
      }
      if (truePeakDb != null && truePeakDb > thresholds.auditHotPeakDbtp) {
        out.push({
          code: "hot_peak",
          severity: "info",
          trackId,
          trackAudioId: v.id,
          message: `${label}: true peak ${truePeakDb.toFixed(1)} dBTP.`,
        });
      }
      if (
        silence &&
        silence.leadMs > thresholds.auditLeadSilenceSeconds * SECOND_MS
      ) {
        out.push({
          code: "long_silence_lead",
          severity: "info",
          trackId,
          trackAudioId: v.id,
          message: `${label}: ${(silence.leadMs / 1000).toFixed(1)} s of leading silence.`,
        });
      }
      if (
        silence &&
        silence.tailMs > thresholds.auditTailSilenceSeconds * SECOND_MS
      ) {
        out.push({
          code: "long_silence_tail",
          severity: "info",
          trackId,
          trackAudioId: v.id,
          message: `${label}: ${(silence.tailMs / 1000).toFixed(1)} s of trailing silence.`,
        });
      }
      if (clippedBins > 0) {
        out.push({
          code: "clipping",
          severity: "warn",
          trackId,
          trackAudioId: v.id,
          message: `${label}: ${clippedBins} clipped 50 ms bins, ${clippedFrames} full-scale frames, ${clippedOverBins} bins over 0 dBTP.`,
        });
      }
      if (duplicateOfId != null) {
        const duplicateOf = versions.find(
          (other) => other.id === duplicateOfId
        );
        const duplicateLabel = duplicateOf
          ? `v${duplicateOf.version} (${duplicateOf.asset.name})`
          : `version ${duplicateOfId}`;
        out.push({
          code: "duplicate_version",
          severity: "warn",
          trackId,
          trackAudioId: v.id,
          message: `${label}: duplicates ${duplicateLabel}.`,
          fix: "unlink_audio_version",
        });
      }
      // Name mismatch: flagged only when the name matches another track's title better than its own.
      const own = nameSimilarity(v.asset.name, title);
      if (own < thresholds.auditNameMismatch) {
        const better = [...titles].find(
          ([id, t]) => id !== trackId && nameSimilarity(v.asset.name, t) > own
        );
        if (better) {
          out.push({
            code: "name_mismatch",
            severity: "warn",
            trackId,
            trackAudioId: v.id,
            message: `${label}: the file name reads like "${better[1]}".`,
          });
        }
      }
    }
  }

  for (const group of audit.duplicateFingerprints) {
    const names = group.trackIds
      .map((id) => `"${titles.get(id) ?? id}"`)
      .join(", ");
    for (const trackId of group.trackIds) {
      out.push({
        code: "duplicate_across_tracks",
        severity: "warn",
        trackId,
        message: `The same audio file is a version of ${names}.`,
      });
    }
  }

  return out;
}

/**
 * Queues duration, waveform, loudness and spectrum analysis for track audios.
 * Returns as soon as the job rows exist — analysis decodes the whole file, far
 * more than a request should carry, so no read path ever waits for it. Audios
 * on a track that belongs to no project are skipped: a job is read through
 * its project, so there would be nobody to show it to.
 */
export async function enqueueAudioAnalysis(
  trackAudioIds: number[]
): Promise<Job[]> {
  if (trackAudioIds.length === 0) return [];

  const rows = await db
    .select({ subjectId: trackAudios.id, projectId: tracks.projectId })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(inArray(trackAudios.id, trackAudioIds));

  return enqueueJobsOnce(
    "audio_analysis",
    rows.flatMap(({ subjectId, projectId }) =>
      projectId == null ? [] : [{ subjectId, projectId }]
    )
  );
}

/** One version's stored features and loudness curve, in the shape `FeatureSet` takes. */
type StoredFeatureRow = {
  id: number;
  version: number;
  durationMs: number | null;
  lufs: number | null;
  truePeakDb: number | null;
  loudnessCurve: (number | null)[] | null;
  onset: Buffer;
  onsetMin: number;
  onsetMax: number;
  mel: Buffer;
  melMin: number;
  melMax: number;
  chroma: Buffer;
  chromaMin: number;
  chromaMax: number;
};

function featuresOf(row: StoredFeatureRow): Features {
  return {
    onset: { bytes: row.onset, min: row.onsetMin, max: row.onsetMax },
    mel: { bytes: row.mel, min: row.melMin, max: row.melMax },
    chroma: { bytes: row.chroma, min: row.chromaMin, max: row.chromaMax },
  };
}

const openFeatureSet = (dsp: Dsp, row: StoredFeatureRow): FeatureSet =>
  new FeatureSet(dsp, featuresOf(row), row.loudnessCurve ?? undefined);

/**
 * Namespaces the advisory lock {@link withTrackAnalysisLock} takes (the
 * two-key overload of `pg_advisory_xact_lock`), so a `trackId` used as a lock
 * key here can never collide with one some other subsystem takes on a plain
 * integer.
 */
export const TRACK_ANALYSIS_LOCK_CLASS = 0x7461;

/**
 * Runs `fn` inside a transaction holding a lock scoped to `trackId`. A fresh
 * analysis reads every other current version of its track to compute the
 * consecutive diff and the duplicate flag, then writes its own row — without
 * this, two versions of the same track analysed at once could each read the
 * other as not-yet-current and both miss the pair. The lock releases
 * automatically when the transaction ends, committed or not.
 */
async function withTrackAnalysisLock<T>(
  trackId: number,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockTracksForAnalysis(tx, [trackId]);
    return fn(tx);
  });
}

/**
 * Takes the lock {@link withTrackAnalysisLock} holds for each of `trackIds`,
 * inside a transaction the caller already has open, for work that reaches
 * several tracks at once. Each lock releases when that transaction ends.
 * Taken in ascending id order, so two such callers reaching overlapping tracks
 * queue behind each other rather than deadlock.
 */
export async function lockTracksForAnalysis(
  tx: Tx,
  trackIds: Iterable<number>
) {
  for (const trackId of [...new Set(trackIds)].sort((a, b) => a - b)) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${TRACK_ANALYSIS_LOCK_CLASS}, ${trackId})`
    );
  }
}

/**
 * Locks the versions of `trackIds` for a delete of those tracks that cascades
 * to them: the tracks' analysis locks, then their `track_audios` rows in
 * ascending id (`docs/agents/db.md`, Lock order). A track delete removes no
 * asset, so the order's first set does not apply.
 */
export async function lockTrackVersions(tx: Tx, trackIds: number[]) {
  if (trackIds.length === 0) return;

  await lockTracksForAnalysis(tx, trackIds);
  await tx
    .select({ id: trackAudios.id })
    .from(trackAudios)
    .where(inArray(trackAudios.trackId, trackIds))
    .orderBy(trackAudios.id)
    .for("update");
}

/**
 * Locks the assets `doomed` matches for a cascading delete, and answers their
 * track-audio rows: the versions the delete is about to remove, for
 * {@link closeVersionGaps} to repair once it has. Read after the tracks'
 * analysis locks, since a holder of one may have renumbered its track.
 *
 * The locks go in the one order every path taking more than one of them
 * keeps (`docs/agents/db.md`, Lock order): the asset rows, then their
 * tracks' analysis locks, then the track-audio rows, each in ascending id. An
 * unlink or an analysis holds a track's lock before it writes a version, so
 * a delete that held a version first and then waited on the track would
 * deadlock against it.
 */
export async function lockDoomedVersions(tx: Tx, doomed: SQL | undefined) {
  await tx
    .select({ id: assets.id })
    .from(assets)
    .where(doomed)
    .orderBy(assets.id)
    .for("update");

  const reached = await tx
    .selectDistinct({ trackId: trackAudios.trackId })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(doomed);
  await lockTracksForAnalysis(
    tx,
    reached.map((row) => row.trackId)
  );

  return tx
    .select({
      trackId: trackAudios.trackId,
      version: trackAudios.version,
      spectrogramKey: trackAudios.spectrogramKey,
      spectrogramBytes: trackAudios.spectrogramBytes,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(doomed)
    .orderBy(trackAudios.id)
    .for("update", { of: trackAudios });
}

/** The columns {@link StoredFeatureRow} reads, over `track_audios` joined to its features. */
const storedFeatureColumns = {
  id: trackAudios.id,
  version: trackAudios.version,
  durationMs: trackAudios.durationMs,
  lufs: trackAudios.lufs,
  truePeakDb: trackAudios.truePeakDb,
  loudnessCurve: trackAudios.loudnessCurve,
  onset: trackAudioFeatures.onset,
  onsetMin: trackAudioFeatures.onsetMin,
  onsetMax: trackAudioFeatures.onsetMax,
  mel: trackAudioFeatures.mel,
  melMin: trackAudioFeatures.melMin,
  melMax: trackAudioFeatures.melMax,
  chroma: trackAudioFeatures.chroma,
  chromaMin: trackAudioFeatures.chromaMin,
  chromaMax: trackAudioFeatures.chromaMax,
};

/**
 * The versions matching `where` whose analysis and stored features are both
 * current, with those features, ordered by version.
 */
async function currentFeatureRows(
  executor: Tx | typeof db,
  where: SQL | undefined
): Promise<StoredFeatureRow[]> {
  return executor
    .select(storedFeatureColumns)
    .from(trackAudios)
    .innerJoin(
      trackAudioFeatures,
      eq(trackAudioFeatures.trackAudioId, trackAudios.id)
    )
    .where(
      and(
        where,
        eq(trackAudios.analysisVersion, ANALYSIS_VERSION),
        eq(trackAudioFeatures.analysisVersion, ANALYSIS_VERSION)
      )
    )
    .orderBy(trackAudios.version);
}

/**
 * Every other current version on `trackId`, with its stored features, for the
 * consecutive-diff and duplicate checks a fresh analysis runs after storing.
 * Ordered by version, so the caller finds its neighbours with a linear scan.
 * Runs inside the caller's locked transaction, so the set it reads cannot
 * change under a concurrent analysis of the same track.
 */
async function currentSiblingVersions(
  tx: Tx,
  trackId: number,
  excludeId?: number
): Promise<StoredFeatureRow[]> {
  return currentFeatureRows(
    tx,
    and(
      eq(trackAudios.trackId, trackId),
      excludeId == null ? undefined : ne(trackAudios.id, excludeId)
    )
  );
}

/**
 * The comparison of `a` with `b` placed `offset` ms later, or aligned from
 * their onset envelopes when no offset is given. `aligned` is false, and
 * `offsetMs` null, when the envelopes correlate too poorly to call the two
 * versions aligned; the diff itself still runs at offset 0, since a
 * placed-but-unconfident comparison beats none.
 */
function compareFeatureSets(
  a: FeatureSet,
  b: FeatureSet,
  offset: number | null = alignFeatures(a, b)
) {
  const aligned = offset !== null;
  const diff = diffFeatures(a, b, offset ?? 0);
  return {
    aligned,
    offsetMs: aligned ? offset : null,
    change: diff.change,
    loudnessDelta: diff.loudnessDelta,
    summary: diff.summary,
    analysisVersion: ANALYSIS_VERSION,
  };
}

/**
 * Aligns `a` onto `b` and stores their comparison, replacing whatever was
 * there for the pair. Runs inside the caller's locked transaction.
 */
async function storeDiff(
  tx: Tx,
  fromId: number,
  toId: number,
  a: FeatureSet,
  b: FeatureSet
): Promise<void> {
  const values = { fromId, toId, ...compareFeatureSets(a, b) };
  await tx
    .insert(trackAudioDiffs)
    .values(values)
    .onConflictDoUpdate({
      target: [trackAudioDiffs.fromId, trackAudioDiffs.toId],
      set: values,
    });
}

/** The loudest a lossy re-encode of the same bounce is seen to overshoot the source's true peak. */
const DUPLICATE_TRUE_PEAK_TOLERANCE_DB = 0.5;
/** The most an encode's integrated loudness is seen to drift from the source's, in LU. */
const DUPLICATE_LUFS_TOLERANCE = 0.5;
/** The most of the track a re-encode's per-second mel content is seen to shift, from rounding. */
const DUPLICATE_CHANGED_SHARE_TOLERANCE = 0.05;

/**
 * The lowest-numbered other current version whose fingerprint matches
 * `thisFeatureSet` closely enough to call a duplicate: similarity above 0.98
 * after alignment, durations within one second, and — since chroma alone
 * cannot tell a remaster from its own arrangement — integrated loudness,
 * true peak and per-second content close enough to call the same master.
 * `null` when nothing qualifies.
 */
function findDuplicate(
  dsp: Dsp,
  thisFeatureSet: FeatureSet,
  thisDurationMs: number,
  thisLufs: number | null,
  thisTruePeakDb: number | null,
  siblings: StoredFeatureRow[]
): number | null {
  let winner: StoredFeatureRow | null = null;
  for (const sibling of siblings) {
    if (
      sibling.durationMs == null ||
      Math.abs(sibling.durationMs - thisDurationMs) > 1000 ||
      sibling.lufs == null ||
      thisLufs == null ||
      Math.abs(sibling.lufs - thisLufs) > DUPLICATE_LUFS_TOLERANCE ||
      sibling.truePeakDb == null ||
      thisTruePeakDb == null ||
      Math.abs(sibling.truePeakDb - thisTruePeakDb) >
        DUPLICATE_TRUE_PEAK_TOLERANCE_DB
    ) {
      continue;
    }
    const other = openFeatureSet(dsp, sibling);
    try {
      const offset = alignFeatures(thisFeatureSet, other);
      const { fingerprintSimilarity, summary } = diffFeatures(
        thisFeatureSet,
        other,
        offset ?? 0
      );
      if (
        fingerprintSimilarity != null &&
        fingerprintSimilarity > 0.98 &&
        summary.changedShare <= DUPLICATE_CHANGED_SHARE_TOLERANCE &&
        (!winner || sibling.version < winner.version)
      ) {
        winner = sibling;
      }
    } finally {
      other.free();
    }
  }
  return winner?.id ?? null;
}

/**
 * Stores the diff between two already-current versions unless one is already
 * there for that exact pair — the check the repair side of a diff-chain
 * update runs, whether it is {@link analyseTrackAudio} checking its own next
 * neighbour or a delete closing the gap it just opened between two others.
 */
async function storeDiffIfMissing(
  tx: Tx,
  fromId: number,
  toId: number,
  from: FeatureSet,
  to: FeatureSet
): Promise<void> {
  const existing = await tx.query.trackAudioDiffs.findFirst({
    where: { fromId, toId },
  });
  if (!existing) await storeDiff(tx, fromId, toId, from, to);
}

/** A version a delete has just removed: its track, and the number it held. */
type RemovedVersion = { trackId: number; version: number };

/**
 * Repairs each track's version chain after `removed` are deleted, cascaded
 * or direct: renumbers the track dense again, and stores the diff between
 * every two current versions that now stand next to each other across a gap
 * (a run of adjacent removals leaves one gap, bridged by one diff). The diffs
 * that named a removed version went with it in the cascade.
 *
 * Runs in the deleting transaction after the rows are gone, holding each
 * track's analysis lock ({@link lockTracksForAnalysis}), so it reads the
 * current versions the way a concurrent analysis would.
 */
export async function closeVersionGaps(tx: Tx, removed: RemovedVersion[]) {
  const removedByTrack = new Map<number, number[]>();
  for (const { trackId, version } of removed) {
    const versions = removedByTrack.get(trackId);
    if (versions) versions.push(version);
    else removedByTrack.set(trackId, [version]);
  }

  let dsp: Dsp | undefined;
  for (const [trackId, versions] of removedByTrack) {
    // Paired by the removed rows' own version numbers — read before
    // `resequenceVersions` renumbers everyone else, but a diff is keyed by
    // id, so what their version numbers become afterward does not matter to
    // the pairs found here.
    const siblings = await currentSiblingVersions(tx, trackId);
    const bridged = siblings.flatMap((next, i) => {
      const previous = siblings[i - 1];
      return previous &&
        versions.some((v) => previous.version < v && v < next.version)
        ? [{ previous, next }]
        : [];
    });

    await resequenceVersions(tx, trackId);

    for (const { previous, next } of bridged) {
      dsp ??= await getDsp();
      const previousSet = openFeatureSet(dsp, previous);
      const nextSet = openFeatureSet(dsp, next);
      try {
        await storeDiffIfMissing(
          tx,
          previous.id,
          next.id,
          previousSet,
          nextSet
        );
      } finally {
        previousSet.free();
        nextSet.free();
      }
    }
  }
}

/** Sharps throughout, C = 0 — `@workspace/dsp/offline`'s own spelling for a detected key's tonic. */
const PITCH_CLASSES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
] as const;

/**
 * A stored session root note as its pitch class, from the one spelling the
 * column holds — `sessionWireFields` normalises every write to
 * {@link ROOT_NOTES}, so there is no flat or lowercase spelling to fold here.
 */
const ROOT_NOTE_PITCH_CLASS: Record<string, number> = Object.fromEntries(
  ROOT_NOTES.map((name, i) => [name, i])
);

/** Parses a `"F♯ minor"` string from `@workspace/dsp/offline` back into a tonic index and mode. */
function parseMusicalKey(
  musicalKey: string
): { tonic: number; mode: "major" | "minor" } | null {
  const [label, mode] = musicalKey.split(" ");
  const tonic = PITCH_CLASSES.indexOf(label as (typeof PITCH_CLASSES)[number]);
  if (tonic < 0 || (mode !== "major" && mode !== "minor")) return null;
  return { tonic, mode };
}

/**
 * The relative tonic of `(tonic, mode)`: same key signature, other mode.
 * Major `t` → relative minor `(t + 9) % 12`; minor `t` → relative major
 * `(t + 3) % 12`. Mirrors `relative_tonic` in `rust/src/analysis/offline/key.rs`.
 */
function relativeTonic(tonic: number, mode: "major" | "minor"): number {
  return mode === "minor" ? (tonic + 3) % 12 : (tonic + 9) % 12;
}

/**
 * A detected tempo settled against the track's main session, for the octave
 * ambiguity autocorrelation alone can't resolve: when the session's own
 * tempo sits within `windowPercent` percent of double or half the detected
 * bpm, but not of the detected bpm itself, the doubled or halved
 * value is what gets stored — one decimal, `beatOffsetMs` reduced modulo the
 * new period when doubling and floored to the whole millisecond its integer
 * column holds (halving keeps it valid as is). `sessionTempo` is
 * `sessions.tempo`, drizzle's `numeric` column read back as a string; a
 * missing or unparsable value, or one that isn't a positive number, leaves
 * `detected` unchanged, as does a `detected` bpm already within the window
 * of the session tempo — checked first, so a detected 136 against a session
 * 135 stays 136 rather than doubling or halving into the window too.
 */
export function settleTempoOctave(
  detected: { bpm: number; beatOffsetMs: number },
  sessionTempo: string | null,
  windowPercent: number
): { bpm: number; beatOffsetMs: number } {
  const session = sessionTempo === null ? NaN : Number(sessionTempo);
  if (!Number.isFinite(session) || session <= 0) return detected;

  const withinWindow = (bpm: number) =>
    Math.abs(bpm - session) <= (windowPercent / 100) * session;
  if (withinWindow(detected.bpm)) return detected;

  for (const factor of [2, 0.5] as const) {
    const bpm = Math.round(detected.bpm * factor * 10) / 10;
    if (!withinWindow(bpm)) continue;
    const periodMs = 60000 / bpm;
    const beatOffsetMs =
      factor === 2
        ? Math.floor(((detected.beatOffsetMs % periodMs) + periodMs) % periodMs)
        : detected.beatOffsetMs;
    return { bpm, beatOffsetMs };
  }
  return detected;
}

/**
 * A detected key settled against the track's main session, for the
 * major/minor ambiguity a shared chroma fingerprint can't resolve on its
 * own: when the session names the detected key's relative (same notes,
 * other mode) as its own key — `scale` reading `Major` or `Minor`, matched
 * case-insensitively so this does not lean on the write-side normaliser
 * having reached every row — the session's
 * own tonic and mode are stored instead, spelled the way the estimator
 * spells it. Any other disagreement is left as detected, since the
 * recording may simply be tuned differently. No session key, or a `scale`
 * that isn't major or minor, leaves `detectedMusicalKey` unchanged.
 */
export function settleKeyMode(
  detectedMusicalKey: string,
  session: { rootNote: string | null; scale: string | null }
): string {
  const detected = parseMusicalKey(detectedMusicalKey);
  if (!detected || !session.rootNote || !session.scale) {
    return detectedMusicalKey;
  }

  const sessionMode = session.scale.trim().toLowerCase();
  if (sessionMode !== "major" && sessionMode !== "minor") {
    return detectedMusicalKey;
  }

  const sessionTonic = ROOT_NOTE_PITCH_CLASS[session.rootNote.trim()];
  if (sessionTonic === undefined) return detectedMusicalKey;

  const relative = {
    tonic: relativeTonic(detected.tonic, detected.mode),
    mode: detected.mode === "minor" ? "major" : "minor",
  } as const;
  if (sessionTonic !== relative.tonic || sessionMode !== relative.mode) {
    return detectedMusicalKey;
  }
  return `${PITCH_CLASSES[sessionTonic]} ${sessionMode}`;
}

/**
 * The ladder every analysis climbs, whether it runs as its own
 * `audio_analysis` job or nested one file at a time inside `audio_backfill`.
 * `decode` carries almost all of it because it is the only step with a
 * natural counter (frames decoded against ffmpeg's own duration); `analyse`
 * ticks once per offline estimator, which run at native speed once the
 * decode has fed them; `store` is fast — the PNG, the row, the diffs and the
 * duplicate flag — and nominal.
 */
const ANALYSIS_STEPS: JobStep[] = [
  { key: "decode", label: "Decoding and measuring", weight: 80 },
  { key: "analyse", label: "Detecting tempo, key and sections", weight: 15 },
  { key: "store", label: "Saving", weight: 5 },
];

/**
 * Decodes the file once into every stored measurement — the streaming peaks,
 * loudness and spectrum, and the whole offline set — and writes them together
 * with the package's `ANALYSIS_VERSION`, so a row is either current or
 * entirely outstanding; nothing is partial. A row already at the current
 * version is left alone. `report` climbs {@link ANALYSIS_STEPS}: `decode`'s
 * progress is the decode's own, and `report.signal` aborts the ffmpeg child
 * when the job is cancelled.
 *
 * After storing: the consecutive diff against the previous current version
 * (and, when it would otherwise leave a gap, the pair against the next
 * current version too), and the duplicate flag against every other current
 * version.
 */
async function analyseTrackAudio(
  trackAudioId: number,
  report: JobReporter
): Promise<void> {
  const [row] = await db
    .select({
      assetPath: assets.assetPath,
      name: assets.name,
      analysisVersion: trackAudios.analysisVersion,
      trackId: trackAudios.trackId,
      projectId: tracks.projectId,
      version: trackAudios.version,
      spectrogramKey: trackAudios.spectrogramKey,
      durationMs: trackAudios.durationMs,
      spectrogramBytes: trackAudios.spectrogramBytes,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(eq(trackAudios.id, trackAudioId));

  if (!row || !isAudioName(row.name)) return;
  if (!isOutstandingAnalysis(row.analysisVersion)) return;

  let thisFeatureSet: FeatureSet | null = null;
  try {
    // `decode` is `ANALYSIS_STEPS`' first entry, so a fresh reporter is
    // already there without a `step` call of its own. A re-analysis (a
    // version bump, most often) already has this row's duration from the
    // run before, so it skips the probe spawn entirely; only a track audio's
    // first analysis pays for one. Decode and synchronous WASM DSP run in a
    // low-priority worker child process so the API event loop stays responsive.
    const measured = await withLocalStoredFile(row.assetPath, (file) =>
      analyseAudioInWorker(file, {
        flags: ANALYSIS_FLAGS,
        onProgress: report.progress,
        onStep: (step) => report.step(step),
        signal: report.signal,
        durationSeconds:
          row.durationMs != null ? row.durationMs / 1000 : undefined,
      })
    );
    if (measured === null) {
      throw new Error(`ffmpeg could not read ${row.name}`);
    }

    const {
      durationMs,
      peaks,
      loudness,
      spectrum,
      tempo,
      key,
      sections,
      spectrogram,
      loudnessCurve,
      correlationCurve,
      clipping,
      silence,
      pitchTrack,
      features,
    } = measured;

    // Autocorrelation and chroma alone can't settle a tempo octave or a
    // major/minor ambiguity; the track's main session, when it has one, is
    // the hint that can. A project that turns correction off stores what
    // was detected, as if the track had no session to go by.
    const { audio } = await projectPolicy(row.projectId);
    const [mainSession] =
      audio.tempoKeyCorrection && (tempo || key)
        ? await db
            .select({
              tempo: sessions.tempo,
              rootNote: sessions.rootNote,
              scale: sessions.scale,
            })
            .from(sessions)
            .where(
              and(eq(sessions.trackId, row.trackId), eq(sessions.main, true))
            )
        : [];
    const settledTempo = tempo
      ? settleTempoOctave(
          tempo,
          mainSession?.tempo ?? null,
          audio.tempoKeyCorrectionPercent
        )
      : null;
    const settledMusicalKey = key
      ? settleKeyMode(key.musicalKey, {
          rootNote: mainSession?.rootNote ?? null,
          scale: mainSession?.scale ?? null,
        })
      : null;

    await report.step("store");
    const tile =
      spectrogram.columns > 0
        ? await writeSpectrogramPng(spectrogram.bytes, spectrogram.columns)
        : null;
    const spectrogramKey = tile?.key ?? null;

    const dsp = features ? await getDsp() : null;
    if (features && dsp) {
      thisFeatureSet = new FeatureSet(dsp, features, loudnessCurve);
    }

    // Everything that reads or writes another version of this track — the
    // sibling scan, the duplicate flag and the neighbouring diffs — runs
    // inside one locked transaction with this row's own update, so a second
    // version of the same track analysed at the same time cannot read this
    // one as not-yet-current.
    await withTrackAnalysisLock(row.trackId, async (tx) => {
      const siblings = await currentSiblingVersions(
        tx,
        row.trackId,
        trackAudioId
      );
      const duplicateOfId =
        thisFeatureSet && dsp
          ? findDuplicate(
              dsp,
              thisFeatureSet,
              durationMs,
              loudness.lufs,
              loudness.truePeakDb,
              siblings
            )
          : null;

      await tx
        .update(trackAudios)
        .set({
          durationMs,
          audioPeaks: peaks,
          lufs: loudness.lufs,
          lra: loudness.lra,
          truePeakDb: loudness.truePeakDb,
          ltas: spectrum,
          bpm: settledTempo?.bpm ?? null,
          bpmConfidence: tempo?.bpmConfidence ?? null,
          beatOffsetMs: settledTempo?.beatOffsetMs ?? null,
          musicalKey: settledMusicalKey,
          keyConfidence: key?.keyConfidence ?? null,
          sections,
          loudnessCurve,
          correlationCurve,
          clipping,
          silence,
          pitchTrack,
          spectrogramKey,
          spectrogramBytes: tile?.bytes ?? 0,
          duplicateOfId,
          analysisVersion: ANALYSIS_VERSION,
        })
        .where(eq(trackAudios.id, trackAudioId));

      // The tile is nobody's upload, so it counts against the project alone.
      // The replaced one leaves the counter in the same breath as the row that
      // named it, whose file is dropped below.
      const projectScopes = scopesOf({ projectId: row.projectId });
      await subtractUsage(tx, projectScopes, row.spectrogramBytes);
      await addUsage(tx, projectScopes, tile?.bytes ?? 0);

      if (features) {
        const values = {
          trackAudioId,
          onset: Buffer.from(features.onset.bytes),
          onsetMin: features.onset.min,
          onsetMax: features.onset.max,
          mel: Buffer.from(features.mel.bytes),
          melMin: features.mel.min,
          melMax: features.mel.max,
          chroma: Buffer.from(features.chroma.bytes),
          chromaMin: features.chroma.min,
          chromaMax: features.chroma.max,
          analysisVersion: ANALYSIS_VERSION,
        };
        await tx.insert(trackAudioFeatures).values(values).onConflictDoUpdate({
          target: trackAudioFeatures.trackAudioId,
          set: values,
        });
      }

      if (thisFeatureSet && dsp) {
        const currentFeatureSet = thisFeatureSet;
        const previous = siblings.filter((s) => s.version < row.version).at(-1);
        const next = siblings.find((s) => s.version > row.version);

        if (previous) {
          const previousSet = openFeatureSet(dsp, previous);
          try {
            await storeDiff(
              tx,
              previous.id,
              trackAudioId,
              previousSet,
              currentFeatureSet
            );
          } finally {
            previousSet.free();
          }
        }

        if (next) {
          const nextSet = openFeatureSet(dsp, next);
          try {
            await storeDiffIfMissing(
              tx,
              trackAudioId,
              next.id,
              currentFeatureSet,
              nextSet
            );
          } finally {
            nextSet.free();
          }
        }
      }
    });

    // The row now points at the new file (or none); the old one is only ever
    // reachable through this key, so it is safe to drop once the row commits.
    if (row.spectrogramKey && row.spectrogramKey !== spectrogramKey) {
      await removeStoredFile(row.spectrogramKey);
    }
  } finally {
    thisFeatureSet?.free();
  }
}

/**
 * One measure's stored value, queueing analysis when the version has fallen
 * behind so a later read finds it current — the healing every lazy reader
 * does. `undefined` while the asset is not audio, or the column is still
 * unmeasured.
 */
export async function getTrackAudioMeasure(
  trackAudioId: number,
  measure: MeasureName
): Promise<unknown> {
  const { column } = TRACK_AUDIO_MEASURES[measure];
  const [row] = await db
    .select({
      value: column,
      name: assets.name,
      analysisVersion: trackAudios.analysisVersion,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(eq(trackAudios.id, trackAudioId));

  if (!row || !isAudioName(row.name)) return undefined;

  if (isOutstandingAnalysis(row.analysisVersion)) {
    await enqueueAudioAnalysis([trackAudioId]);
  }
  return row.value ?? undefined;
}

/** A comparison between two versions, stored or computed on request. */
export type TrackAudioPairDiff = Omit<
  TrackAudioDiff,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * The comparison of `fromId` with `toId`, two versions of the same track, per
 * second of `fromId`: the stored row for that direction when one exists
 * (consecutive versions are stored as analysis runs), otherwise computed from
 * both versions' stored features and not stored. A pair stored the other way
 * round keeps its alignment, negated, so both directions place the versions
 * against each other identically. Undefined when either version is missing,
 * the two belong to different tracks, or either has no current features yet.
 */
export async function getTrackAudioDiff(
  fromId: number,
  toId: number
): Promise<TrackAudioPairDiff | undefined> {
  const pair = await db
    .select({ id: trackAudios.id, trackId: trackAudios.trackId })
    .from(trackAudios)
    .where(inArray(trackAudios.id, [fromId, toId]));
  const trackIds = new Set(pair.map((row) => row.trackId));
  if (fromId === toId || pair.length !== 2 || trackIds.size !== 1) {
    return undefined;
  }

  const stored = await db.query.trackAudioDiffs.findFirst({
    where: { fromId, toId },
    columns: { id: false, createdAt: false, updatedAt: false },
  });
  if (stored) return stored;

  const rows = await currentFeatureRows(
    db,
    inArray(trackAudios.id, [fromId, toId])
  );
  const fromRow = rows.find((row) => row.id === fromId);
  const toRow = rows.find((row) => row.id === toId);
  if (!fromRow || !toRow) return undefined;

  const reversed = await db.query.trackAudioDiffs.findFirst({
    where: { fromId: toId, toId: fromId },
    columns: { offsetMs: true },
  });
  const dsp = await getDsp();
  const from = openFeatureSet(dsp, fromRow);
  try {
    const to = openFeatureSet(dsp, toRow);
    try {
      const offset = reversed
        ? reversed.offsetMs === null
          ? null
          : -reversed.offsetMs
        : undefined;
      return { fromId, toId, ...compareFeatureSets(from, to, offset) };
    } finally {
      to.free();
    }
  } finally {
    from.free();
  }
}

/**
 * The stored durations for a set of track audios, keyed by track audio id.
 * A row whose analysis has fallen behind `ANALYSIS_VERSION` still returns its
 * last measured duration while a fresh one is queued, the same as every other
 * lazy reader — a stale number beats no number, and the map fills in as
 * outstanding rows are analysed. Rows with no duration yet are absent from
 * the map.
 */
export async function getTrackAudioDurations(
  trackAudioIds: number[]
): Promise<Map<number, number>> {
  const durations = new Map<number, number>();
  if (trackAudioIds.length === 0) return durations;

  const rows = await db
    .select({
      id: trackAudios.id,
      durationMs: trackAudios.durationMs,
      name: assets.name,
      analysisVersion: trackAudios.analysisVersion,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(inArray(trackAudios.id, trackAudioIds));

  const unanalysed: number[] = [];
  for (const row of rows) {
    if (row.durationMs != null) durations.set(row.id, row.durationMs);
    if (isOutstandingAnalysis(row.analysisVersion) && isAudioName(row.name)) {
      unanalysed.push(row.id);
    }
  }
  await enqueueAudioAnalysis(unanalysed);

  return durations;
}

export type CollectionRuntime = {
  /** Summed playing time of the primary audios whose duration is known. */
  runtimeMs: number;
  /** False while any primary audio is still waiting on its duration. */
  complete: boolean;
};

/**
 * Total playing time of a collection in milliseconds: the sum of its tracks'
 * primary audio durations. Tracks with no primary audio contribute nothing, so
 * a part-filled collection still reports the runtime it has. A primary audio
 * that has not been analysed yet also contributes nothing, and makes the total
 * incomplete rather than wrong.
 */
export async function getCollectionRuntimeMs(
  collectionId: number
): Promise<CollectionRuntime> {
  const rows = await db
    .select({ id: trackAudios.id })
    .from(collectionTracks)
    .innerJoin(
      trackAudios,
      and(
        eq(trackAudios.trackId, collectionTracks.trackId),
        eq(trackAudios.isPrimary, true)
      )
    )
    .where(eq(collectionTracks.collectionId, collectionId));

  const durations = await getTrackAudioDurations(rows.map((r) => r.id));
  return {
    runtimeMs: [...durations.values()].reduce((total, ms) => total + ms, 0),
    complete: durations.size === rows.length,
  };
}

export type CollectionLoudness = {
  /** Quietest primary audio's integrated loudness, in LUFS. */
  min: number;
  /** Loudest primary audio's integrated loudness, in LUFS. */
  max: number;
  /** Median integrated loudness across measured primary audios, in LUFS. */
  median: number;
  /** How many primary audios have a measured loudness. */
  measured: number;
  /** How many tracks in the collection have a primary audio at all. */
  total: number;
  /** Each track with a measured primary audio, in track order. */
  tracks: { id: number; title: string; lufs: number }[];
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export type CollectionSpectrum = SpectrumEnvelope & {
  /** How many primary audios have a measured spectrum. */
  measured: number;
  /** How many tracks in the collection have a primary audio at all. */
  total: number;
};

export type CollectionTempo = {
  /** Slowest detected tempo, in BPM. */
  min: number;
  /** Fastest detected tempo, in BPM. */
  max: number;
  /** Median detected tempo across measured primary audios, in BPM. */
  median: number;
  /** How many primary audios have a detected tempo. */
  measured: number;
  /** Each track with a detected tempo, in track order. */
  tracks: { id: number; title: string; bpm: number }[];
};

export type CollectionKeyTrack = {
  id: number;
  title: string;
  /** The primary audio's detected key, e.g. `"F♯ minor"`. */
  key: string;
};

export type CollectionAudioSummary = {
  loudness: CollectionLoudness | null;
  spectrum: CollectionSpectrum | null;
  tempo: CollectionTempo | null;
  /** Every track with a detected key, in track order — one dot per track on
   *  the circle of fifths, not aggregated by key. */
  keys: CollectionKeyTrack[];
};

/** One of a collection's primary audios, with whatever has been measured of it. */
type PrimaryAudioRow = {
  id: number;
  lufs: number | null;
  ltas: Spectrum | null;
  bpm: number | null;
  musicalKey: string | null;
  name: string;
  trackId: number;
  title: string;
  analysisVersion: number | null;
};

/**
 * The collection's primary audios in track order, with whatever has been
 * measured of each. Rows still missing a measurement have their analysis
 * queued, so a later read finds more of them filled in.
 */
async function collectionPrimaryAudios(
  collectionId: number
): Promise<PrimaryAudioRow[]> {
  const rows = await db
    .select({
      id: trackAudios.id,
      lufs: trackAudios.lufs,
      ltas: trackAudios.ltas,
      bpm: trackAudios.bpm,
      musicalKey: trackAudios.musicalKey,
      name: assets.name,
      trackId: tracks.id,
      title: tracks.title,
      analysisVersion: trackAudios.analysisVersion,
    })
    .from(collectionTracks)
    .innerJoin(
      trackAudios,
      and(
        eq(trackAudios.trackId, collectionTracks.trackId),
        eq(trackAudios.isPrimary, true)
      )
    )
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .innerJoin(tracks, eq(tracks.id, collectionTracks.trackId))
    .where(eq(collectionTracks.collectionId, collectionId))
    .orderBy(
      sql`${collectionTracks.trackNumber} asc nulls last`,
      collectionTracks.trackId
    );

  await enqueueAudioAnalysis(
    rows
      .filter(
        (row) =>
          isOutstandingAnalysis(row.analysisVersion) && isAudioName(row.name)
      )
      .map((row) => row.id)
  );
  return rows;
}

/**
 * Loudness spread across a collection's tracks' primary audios: the range and
 * median of whatever has been measured so far, plus how much of the
 * collection that covers. `null` when nothing has a primary audio measured
 * yet, so the caller can show "not analysed" rather than a bogus zero.
 * `measured < total` while analysis is still running, which is what the
 * client polls this endpoint to notice.
 */
function summariseLoudness(rows: PrimaryAudioRow[]): CollectionLoudness | null {
  const measuredTracks = rows.flatMap((row) =>
    row.lufs == null
      ? []
      : [{ id: row.trackId, title: row.title, lufs: row.lufs }]
  );
  if (measuredTracks.length === 0) return null;

  const measured = measuredTracks.map((track) => track.lufs);
  return {
    min: Math.min(...measured),
    max: Math.max(...measured),
    median: median(measured),
    measured: measured.length,
    total: rows.length,
    tracks: measuredTracks,
  };
}

/**
 * The spectral envelope of the collection's measured primary audios: the
 * power-domain mean curve and the band-wise spread around it. `null` until one
 * of them has a spectrum.
 */
function summariseSpectrum(rows: PrimaryAudioRow[]): CollectionSpectrum | null {
  const curves = rows.flatMap((row) => (row.ltas ? [row.ltas] : []));
  const envelope = spectrumEnvelope(curves);
  if (!envelope) return null;
  return { ...envelope, measured: curves.length, total: rows.length };
}

/**
 * Tempo spread across a collection's tracks' primary audios, the same shape
 * as {@link summariseLoudness}: `null` until something has a detected tempo.
 */
function summariseTempo(rows: PrimaryAudioRow[]): CollectionTempo | null {
  const measuredTracks = rows.flatMap((row) =>
    row.bpm == null ? [] : [{ id: row.trackId, title: row.title, bpm: row.bpm }]
  );
  if (measuredTracks.length === 0) return null;
  const measured = measuredTracks.map((track) => track.bpm);
  return {
    min: Math.min(...measured),
    max: Math.max(...measured),
    median: median(measured),
    measured: measured.length,
    tracks: measuredTracks,
  };
}

/**
 * Every track with a detected key, in track order — a dot per track rather
 * than an aggregated count, so `CollectionKeys` can place each one on the
 * circle of fifths and name it on hover. Empty until something has a
 * detected key.
 */
function summariseKeys(rows: PrimaryAudioRow[]): CollectionKeyTrack[] {
  return rows.flatMap((row) =>
    row.musicalKey == null
      ? []
      : [{ id: row.trackId, title: row.title, key: row.musicalKey }]
  );
}

/** Every summary from one read, since the status route wants all of them. */
export async function getCollectionAudioSummary(
  collectionId: number
): Promise<CollectionAudioSummary> {
  const rows = await collectionPrimaryAudios(collectionId);
  return {
    loudness: summariseLoudness(rows),
    spectrum: summariseSpectrum(rows),
    tempo: summariseTempo(rows),
    keys: summariseKeys(rows),
  };
}

/**
 * The project's audio files whose analysis is outstanding, as track audio
 * ids.
 */
async function projectAudioIds(projectId: number) {
  const rows = await db
    .select({
      id: trackAudios.id,
      name: assets.name,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(and(eq(tracks.projectId, projectId), outstandingAnalysis));

  return rows.filter((row) => isAudioName(row.name)).map((row) => row.id);
}

/**
 * The outstanding-work finder for `audio_backfill`: one subject per project
 * that has an audio-named row whose analysis has fallen behind
 * `ANALYSIS_VERSION`, whose file is still on disk. A project whose only
 * outstanding rows have non-audio names or missing files reports nothing —
 * the analysis would find nothing to measure, and a no-op backfill would
 * queue for it on every boot. Neither does a project that does not analyse
 * automatically: its backfill waits for someone to ask for it.
 */
async function findOutstandingAudioBackfills() {
  const rows = await db
    .select({
      projectId: tracks.projectId,
      name: assets.name,
      assetPath: assets.assetPath,
    })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(outstandingAnalysis);

  const measurable = await Promise.all(
    rows.map(
      async (row) =>
        isAudioName(row.name) && (await storedFileExists(row.assetPath))
    )
  );
  const projectIds = [
    ...new Set(
      rows.filter((_, index) => measurable[index]).map((row) => row.projectId)
    ),
  ];
  const automatic = await Promise.all(
    projectIds.map(
      async (projectId) => (await projectPolicy(projectId)).audio.autoAnalyse
    )
  );

  return projectIds
    .filter((_, index) => automatic[index])
    .map((projectId) => ({ subjectId: projectId, projectId }));
}

/**
 * Fills in a project's outstanding analysis: every track audio whose version
 * has fallen behind `ANALYSIS_VERSION`.
 *
 * Analysis is otherwise only queued when an audio is linked, which leaves rows
 * that predate that — or whose file was unreadable at the time, or whose
 * stored measurements predate a package change — without a current
 * measurement. This walks the project's audios directly so they can be filled
 * in deliberately, one job for the whole pass so its progress is a single
 * thing to poll.
 */
export async function enqueueAudioBackfill(
  projectId: number,
  { createdBy }: { createdBy?: string } = {}
): Promise<Job> {
  return enqueueJob({
    projectId,
    kind: "audio_backfill",
    subjectId: projectId,
    createdBy,
  });
}

/** The name of each track audio's file, by track audio id. */
async function trackAudioNames(ids: number[]): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: trackAudios.id, name: assets.name })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(inArray(trackAudios.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

// A boot pass covers this project by project, through `audio_backfill`'s own
// finder below, so `audio_analysis` — one audio at a time — registers none.
registerJobHandler(
  "audio_analysis",
  async (job, report) => {
    if (job.subjectId == null) throw new Error("job names no track audio");

    await analyseTrackAudio(job.subjectId, report);
  },
  {
    label: "Analysing audio",
    maxAttempts: 3,
    steps: ANALYSIS_STEPS,
    subjectLabels: labelsBySubject(trackAudioNames),
  }
);

registerJobHandler(
  "audio_backfill",
  async (job, report) => {
    if (job.projectId == null) throw new Error("job names no project");

    const ids = await projectAudioIds(job.projectId);
    // One step per file, equal weight, so the bar both moves inside a file's
    // decode and accumulates correctly across the whole project — a single
    // shared `report.child()` call per file would instead map every file's
    // 0..1 onto the same position, sawtoothing back to 0 at each boundary.
    const perFile = report.child(
      ids.map((id) => ({
        key: String(id),
        label: "Analysing audio",
        weight: 1,
      }))
    );

    let analysed = 0;
    const cooldownMs = process.env.NODE_ENV === "test" ? 0 : 250;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      await perFile.step(String(id));
      // A second child nests the analysis ladder inside this file's step, so
      // the bar moves through decode, analyse and store within every file
      // rather than jumping from the file's start straight to its end.
      const fileReport = perFile.child(ANALYSIS_STEPS);
      try {
        await analyseTrackAudio(id, fileReport);
        analysed++;
      } catch (error) {
        // A cancel still has to stop the pass; only a decode failure is
        // tolerated so one unreadable file cannot block every file after it.
        if (report.signal.aborted) throw error;
        logger.warn("could not analyse a track audio during backfill", {
          trackAudioId: id,
          projectId: job.projectId,
          ...errorFields(error),
        });
      }
      if (cooldownMs > 0 && i < ids.length - 1 && !report.signal.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, cooldownMs);
          report.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
      }
    }

    return { analysed };
  },
  {
    label: "Analysing project audio",
    maxAttempts: 3,
    outstanding: findOutstandingAudioBackfills,
    // A backfill is about its whole project; what sets one apart is how many
    // files it went through, which is known once it has finished.
    subjectLabels: async (rows) =>
      new Map(
        rows.map((row) => {
          const analysed = row.result?.analysed;
          return [
            row.id,
            typeof analysed === "number"
              ? `${analysed} ${analysed === 1 ? "file" : "files"}`
              : null,
          ];
        })
      ),
  }
);
