import {
  and,
  asc,
  count,
  desc,
  eq,
  getColumns,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  artworkForTrack,
  artworkForTracks,
  artworkSchema,
  withArtwork,
} from "../../db/queries/artwork.js";
import { recordActivityDiffs } from "../../db/queries/activity.js";
import { isStatusUsable } from "../../db/queries/authorization.js";
import {
  fieldBagOf,
  fieldFilterWhere,
  fieldListing,
  valuesFor,
  withFieldValues,
} from "../../db/queries/custom-fields.js";
import {
  clearEntityLabels,
  getEntityLabels,
  getEntityLabelsBatch,
  linkLabelsInProject,
} from "../../db/queries/labels.js";
import {
  type ArchivedScope,
  archivedScopeSchema,
  type BulkSelection,
  deleteSelected,
  escapeLikeTerm,
  type ExpandedGroupKey,
  expandedGroupedIdRows,
  expandedGroupSummaries,
  facetCounts,
  type Facets,
  type GroupKey,
  groupedIdRows,
  groupSummaries,
  hydratePage,
  membershipFilterSql,
  offsetOf,
  ownGroupKey,
  type Paginated,
  paginationQuerySchema,
  parseSort,
  selectionFilters,
  selectionIds,
  selectionNumber,
  selectionScope,
  selectionString,
  sortTerm,
  statusFilterSql,
  type TableJoin,
  withJoins,
} from "../../db/queries/pagination.js";
import {
  type DefaultableLevel,
  priorityLevelColumns,
  withDefaultLevel,
} from "../../db/queries/priority-levels.js";
import { projectPolicy } from "../../db/queries/project-policy.js";
import { trackSaveStats } from "../../db/queries/saves.js";
import type { SharelinkTrack } from "../../db/queries/sharelinks.js";
import {
  getTrackRelationEdges,
  getTrackRelationEdgesBatch,
  trackRelationEdgeSchema,
} from "../../db/queries/track-relations.js";
import {
  projectScope,
  recomputeUsage,
} from "../../db/queries/storage-usage.js";
import {
  lockTrackVersions,
  spectrogramKeysForTracksMatching,
  withBouncedFrom,
} from "../../db/queries/track-audios.js";
import {
  assets,
  assetSchema,
  attachedAssetSchema,
  attachmentsWithUploadedBy,
} from "../../db/schema/assets.js";
import { trackAttachments } from "../../db/schema/attachments.js";
import {
  collectionSchema,
  collectionTracks,
} from "../../db/schema/collections.js";
import { entityLabels, labels, labelSchema } from "../../db/schema/labels.js";
import { notes, noteSchema } from "../../db/schema/notes.js";
import {
  priorityLevels,
  priorityLevelSchema,
} from "../../db/schema/priority-levels.js";
import { saves } from "../../db/schema/saves.js";
import {
  type Session,
  sessions,
  sessionSchema,
} from "../../db/schema/sessions.js";
import { statuses, statusSchema } from "../../db/schema/statuses.js";
import {
  type NewTrack,
  type Track,
  trackAudioLazyColumns,
  sharedTrackAudioColumns,
  trackAudios,
  trackAudioWithAssetSchema,
  trackRelations,
  tracks,
  trackSchema,
} from "../../db/schema/tracks.js";
import { removeStoredFile } from "../../lib/storage.js";
import { nullsToUndefined } from "../../lib/utils.js";
import {
  type RelationFilter,
  relationFilterSchema,
  trackAuditFilterSchema,
  trackFilterSchema,
} from "./filters.js";

/**
 * Enough of a linked note for the track page to choose between the empty
 * lyrics state and the in-place editor, without opening its encrypted body.
 */
const trackNoteSchema = noteSchema.pick({
  id: true,
  authorId: true,
  lyricsMode: true,
});

const getTrackSchema = withFieldValues(
  trackSchema.extend({
    status: statusSchema,
    priority: priorityLevelSchema,
    attachments: z.array(attachedAssetSchema),
    sessions: z.array(sessionSchema),
    collections: z.array(collectionSchema),
    audios: z.array(trackAudioWithAssetSchema),
    primaryAudio: trackAudioWithAssetSchema.nullable(),
    relations: z.array(trackRelationEdgeSchema),
    labels: z.array(labelSchema),
    note: trackNoteSchema.nullable(),
    /** Derived from the track's main session — see `deriveTrackMusicMeta`. */
    key: z.string().nullable(),
    keyTonic: z.string().nullable(),
    keyScale: z.string().nullable(),
    bpm: z.string().nullable(),
    /**
     * The track's position within one collection. It belongs to the membership
     * rather than the track, so it is only present on a listing scoped to a
     * collection.
     */
    trackNumber: z.number().nullable().optional(),
  })
);

/**
 * A session as it appears on a track in a listing: enough to render the
 * sessions chips and derive the track's key and tempo. The full rows are
 * fetched from `GET /tracks/:id/sessions` when a track's sub-rows open.
 */
const trackSessionSummarySchema = sessionSchema.pick({
  id: true,
  name: true,
  trackId: true,
  main: true,
  rootNote: true,
  scale: true,
  tempo: true,
});

/**
 * A collection as a listed track names it: enough to link the chip, and the
 * cover the track falls back to when it has none of its own.
 */
const listTrackCollectionSchema = collectionSchema.pick({
  id: true,
  title: true,
  image: true,
});

/**
 * A track as a listing returns it: every scalar the table's columns render
 * plus the joined rows its cells link to. What the detail response adds — the
 * notes document, the attachments, and the audio rows with their assets — is
 * per-track weight that a page of fifty would carry fifty times over for
 * cells that do not exist.
 */
export const listTrackSchema = withFieldValues(
  trackSchema.omit({ notes: true, notesText: true }).extend({
    status: statusSchema.nullable(),
    priority: priorityLevelSchema,
    collections: z.array(listTrackCollectionSchema),
    sessions: z.array(trackSessionSummarySchema),
    relations: z.array(trackRelationEdgeSchema),
    labels: z.array(labelSchema),
    key: z.string().nullable(),
    keyTonic: z.string().nullable(),
    keyScale: z.string().nullable(),
    bpm: z.string().nullable(),
    trackNumber: z.number().nullable().optional(),
    /** Integrated loudness of the primary audio, null until measured. */
    lufs: z.number().nullable(),
    /** The version the primary audio's fingerprint duplicates, null when it
     *  is not a duplicate or has no primary audio. */
    duplicateOfVersion: z.number().nullable(),
    /** The newest save across the track's sessions, null with none. */
    lastSaveAt: z.date().nullable(),
    /** How many saves the track's sessions have recorded. */
    saveCount: z.number(),
    /** Whether the track has a non-empty notes document. */
    hasNotes: z.boolean(),
    /** Whether the track has a linked lyrics note. */
    hasLyrics: z.boolean(),
    /** How many audio versions are linked to the track. */
    audioCount: z.number(),
  })
);

export type ListTrack = z.infer<typeof listTrackSchema>;

/**
 * A track's key and tempo live on its main session (the DAW project file),
 * not the track. Composes the wire values the API exposes on a track from
 * that session: `key` as "<root note> <scale>" for search and sorting, its
 * two halves as `keyTonic` and `keyScale` for a reader that spells the key
 * its own way, and `bpm` as the raw tempo.
 */
export function deriveTrackMusicMeta(
  sessions: Pick<Session, "main" | "rootNote" | "scale" | "tempo">[]
): {
  key: string | null;
  keyTonic: string | null;
  keyScale: string | null;
  bpm: string | null;
} {
  const main = sessions.find((s) => s.main);
  const keyTonic = main?.rootNote || null;
  const keyScale = main?.scale || null;
  const key = [keyTonic, keyScale].filter(Boolean).join(" ") || null;
  return { key, keyTonic, keyScale, bpm: main?.tempo ?? null };
}

/**
 * Every session belonging to a track, in the order the table shows its
 * sub-rows: the main session first, then most recently updated. Serves the
 * expand-a-track fetch, so it returns whole session rows where the track
 * listing carries only `trackSessionSummarySchema`.
 */
export async function getTrackSessions(trackId: number): Promise<Session[]> {
  return db.query.sessions.findMany({
    where: { trackId },
    orderBy: { main: "desc", updatedAt: "desc" },
  });
}

/**
 * The project each of a set of track ids belongs to, in one statement. Ids that
 * name no track are absent from the map, so it can be smaller than the input —
 * the caller checks the ids it cares about separately.
 */
export async function projectsByTrackId(
  trackIds: number[]
): Promise<Map<number, number>> {
  if (trackIds.length === 0) return new Map();
  const rows = await db
    .select({ id: tracks.id, projectId: tracks.projectId })
    .from(tracks)
    .where(inArray(tracks.id, trackIds));
  return new Map(rows.map((row) => [row.id, row.projectId]));
}

/** A track with everything its page reads. */
export const trackDetailSchema = withArtwork(getTrackSchema);

export type TrackDetail = z.infer<typeof trackDetailSchema>;

export async function getSharelinkTrack(
  trackId: number
): Promise<SharelinkTrack> {
  // A standalone track share has nothing to order against — `position` only
  // means something inside a collection, which `getSharelinkTracksInCollection`
  // handles separately.
  const [result] = await db
    .select({
      id: tracks.id,
      title: tracks.title,
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
    .from(tracks)
    .leftJoin(trackAudios, eq(trackAudios.trackId, tracks.id))
    .leftJoin(assets, eq(trackAudios.assetId, assets.id))
    .where(and(eq(trackAudios.isPrimary, true), eq(tracks.id, trackId)));
  if (!result) throw new HTTPException(404);

  return nullsToUndefined(result);
}

export async function getTrack(trackId: number): Promise<TrackDetail> {
  const result = await db.query.tracks.findFirst({
    with: {
      sessions: true,
      attachments: attachmentsWithUploadedBy,
      // Every lazy measure (`audio_peaks` alone is ~90 KB per version) is read
      // only through the measures route; `trackAudioSchema` omits them too.
      audios: {
        columns: trackAudioLazyColumns,
        with: { asset: true },
      },
      primaryAudio: {
        columns: trackAudioLazyColumns,
        with: { asset: true },
      },
      status: true,
      priority: { columns: priorityLevelColumns },
      collections: true,
      note: { columns: { id: true, authorId: true, lyricsMode: true } },
    },
    where: {
      id: trackId,
    },
  });

  if (!result) throw new HTTPException(404);

  const [relations, labels, artwork, fields] = await Promise.all([
    getTrackRelationEdges(trackId),
    getEntityLabels("track", trackId),
    artworkForTrack(result),
    fieldBagOf("track", trackId),
  ]);

  const [audios, [primary] = []] = await Promise.all([
    withBouncedFrom(result.audios),
    withBouncedFrom(result.primaryAudio ? [result.primaryAudio] : []),
  ]);

  return {
    ...result,
    audios,
    primaryAudio: primary ?? null,
    ...deriveTrackMusicMeta(result.sessions),
    relations,
    labels,
    artwork,
    fields,
  };
}

export const trackAttachmentsSchema = z.array(assetSchema);

/** A track's attached assets, newest first. */
export async function getTrackAttachments(
  trackId: number
): Promise<(typeof assets.$inferSelect)[]> {
  return db
    .select(getColumns(assets))
    .from(trackAttachments)
    .innerJoin(assets, eq(trackAttachments.assetId, assets.id))
    .where(eq(trackAttachments.trackId, trackId))
    .orderBy(desc(assets.createdAt));
}

/** The bare track row, no relations — for diffing before an update. */
export async function getTrackRow(trackId: number): Promise<Track | undefined> {
  const [row] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  return row;
}

export async function updateTrack(
  trackId: number,
  track: Partial<NewTrack>
): Promise<Track> {
  const [result] = await db
    .update(tracks)
    .set(track)
    .where(eq(tracks.id, trackId))
    .returning();

  if (!result) throw new HTTPException(404);

  return result;
}

export async function updateTrackStatus(
  trackId: number,
  status: { statusId: number }
): Promise<Track> {
  return updateTrack(trackId, status);
}

/**
 * Deletes a track. Cascading FKs handle its attachments (track_attachments
 * onDelete: cascade) and collections; sessions point at the track via a
 * set-null FK, so unlinked sessions survive — callers that re-home sessions
 * should move them before deleting. Label links have no FK to the track and
 * are cleared explicitly.
 *
 * A track's versions (`track_audios`) cascade with it, taking any spectrogram
 * PNGs they named; those are read before the delete and removed once it has
 * committed, the same split every stored-file cleanup in the codebase uses.
 * The delete takes them under the locks every writer of a track's versions
 * holds first ({@link lockTrackVersions}), so it queues behind one of them
 * rather than deadlocking against it.
 */
export async function deleteTrack(trackId: number): Promise<Track> {
  const spectrogramKeys = await spectrogramKeysForTracksMatching(
    eq(tracks.id, trackId)
  );

  const result = await db.transaction(async (tx) => {
    await lockTrackVersions(tx, [trackId]);
    await clearEntityLabels(tx, "track", trackId);
    const [result] = await tx
      .delete(tracks)
      .where(eq(tracks.id, trackId))
      .returning();

    if (!result) throw new HTTPException(404);

    return result;
  });

  // The versions cascaded with the track, taking spectrogram bytes no
  // statement here could subtract; the project's counter is re-derived instead.
  await recomputeUsage([projectScope(result.projectId)]);

  for (const key of spectrogramKeys) await removeStoredFile(key);

  return result;
}

/**
 * A track as a create names it; whatever it leaves out, the project's policy
 * fills, and its priority the project's default level.
 */
export type TrackCreate = Omit<DefaultableLevel<NewTrack>, "artists"> & {
  artists?: string[];
};

/**
 * Creates a track, filling what the body leaves out from the project's
 * defaults: artists, the explicit flag, a status the project can use (one it
 * no longer has falls to the column default) and the project's default
 * priority level, and the default labels it still has, linked in the same
 * transaction as the row.
 */
export async function createTrack(track: TrackCreate): Promise<Track> {
  const { defaults } = await projectPolicy(track.projectId);
  const defaultStatus =
    track.statusId === undefined &&
    (await isStatusUsable(defaults.trackStatusId, track.projectId))
      ? { statusId: defaults.trackStatusId }
      : {};

  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(tracks)
      .values(
        await withDefaultLevel(
          {
            ...track,
            artists: track.artists ?? defaults.artists,
            explicit: track.explicit ?? defaults.explicit,
            ...defaultStatus,
          },
          tx
        )
      )
      .returning();

    if (!result) throw new Error("Failed to create track");

    await linkLabelsInProject(
      tx,
      result.projectId,
      "track",
      result.id,
      defaults.labelIds
    );
    return result;
  });
}

/*
 * The project-scoped track listing: sort keys, groupings, filters, the
 * paginated page, the bulk writes and the summary list.
 */

/**
 * `key` and `bpm` are derived from the track's main session, so sorting by
 * them orders on that session's columns. `mainSessionKey` recomposes the
 * "<root note> <scale>" string the API exposes.
 */
const mainSessionKey = sql`nullif(trim(concat_ws(' ', ${sessions.rootNote}, ${sessions.scale})), '')`;

const primaryAudioLufs = sql`(select ${trackAudios.lufs} from ${trackAudios} where ${trackAudios.trackId} = ${tracks.id} and ${trackAudios.isPrimary} = true)`;

/**
 * "Last save" and "Saves" aggregate the saves of every session on the
 * track. Like `primaryAudioLufs` they are correlated subqueries rather than
 * joins, so they sort a grouped page as well as a plain one.
 */
const trackSavesFrom = sql`from ${saves} join ${sessions} on ${sessions.id} = ${saves.sessionId} where ${sessions.trackId} = ${tracks.id}`;
const trackLastSaveAt = sql`(select max(${saves.fileUpdatedAt}) ${trackSavesFrom})`;
const trackSaveCount = sql`(select count(*) ${trackSavesFrom})`;

const trackSortColumns = {
  id: tracks.id,
  title: tracks.title,
  priority: priorityLevels.rank,
  bpm: sessions.tempo,
  key: mainSessionKey,
  isrc: tracks.isrc,
  iswc: tracks.iswc,
  releaseDate: tracks.releaseDate,
  explicit: tracks.explicit,
  tracks: sessions.tracksCount,
  status: statuses.percentage,
  lufs: primaryAudioLufs,
  lastSaveAt: trackLastSaveAt,
  saveCount: trackSaveCount,
  createdAt: tracks.createdAt,
  updatedAt: tracks.updatedAt,
} as const;

const statusJoin: TableJoin = {
  table: statuses,
  on: eq(tracks.statusId, statuses.id),
};

const priorityJoin: TableJoin = {
  table: priorityLevels,
  on: eq(tracks.priorityId, priorityLevels.id),
};

const mainSessionJoin: TableJoin = {
  table: sessions,
  on: sql`${sessions.trackId} = ${tracks.id} and ${sessions.main} = true`,
};

/**
 * The joins a track sort key reads beyond `tracks`, applied by the plain and
 * the grouped page alike. A key absent here needs none.
 */
const trackSortJoins: Partial<
  Record<keyof typeof trackSortColumns, readonly TableJoin[]>
> = {
  status: [statusJoin],
  priority: [priorityJoin],
  bpm: [mainSessionJoin],
  key: [mainSessionJoin],
  tracks: [mainSessionJoin],
};

const trackGroupKeys: Record<string, GroupKey> = {
  status: {
    keyColumn: tracks.statusId,
    orderColumn: statuses.percentage,
    labelColumn: statuses.name,
    joins: [statusJoin],
    noneLabel: "No status",
  },
  priority: {
    keyColumn: tracks.priorityId,
    orderColumn: priorityLevels.rank,
    labelColumn: priorityLevels.name,
    joins: [priorityJoin],
    noneLabel: "No priority",
  },
};

/**
 * Many-to-many groupings for tracks. `label` expands through `entity_labels`;
 * `artist` unnests the `artists` jsonb array, keying and labelling by the
 * artist name itself.
 */
const trackExpandedGroupKeys: Record<string, ExpandedGroupKey> = {
  label: {
    pairs: sql`
      select ${entityLabels.entityId} as entity_id,
             ${entityLabels.labelId} as key,
             ${labels.name} as label
      from ${entityLabels}
      join ${labels} on ${labels.id} = ${entityLabels.labelId}
      where ${entityLabels.entityType} = 'track'
    `,
    noneLabel: "No labels",
  },
  artist: {
    pairs: sql`
      select ${tracks.id} as entity_id,
             artist.value as key,
             artist.value as label
      from ${tracks},
           jsonb_array_elements_text(${tracks.artists}) as artist(value)
    `,
    noneLabel: "No artists",
  },
};

/**
 * Every key a track listing sorts by: the joined columns above, plus
 * `trackNumber`, which has no column of its own — it orders by the track's
 * number inside the collection a `collection` filter names. One array so the
 * whitelist `parseSort` enforces and the keys callers are offered cannot
 * drift apart.
 */
export const trackSortKeys: readonly string[] = [
  ...Object.keys(trackSortColumns),
  "trackNumber",
];

/** Every key a track listing groups by, across both the plain and expanded maps. */
export const trackGroupColumns: readonly string[] = [
  ...Object.keys(trackGroupKeys),
  ...Object.keys(trackExpandedGroupKeys),
];

type TrackFilters = {
  q?: string;
  status?: number;
  priority?: number[];
  collection?: number;
  relation?: RelationFilter;
  label?: number;
  artist?: string;
  explicit?: boolean;
  unlabeled?: boolean;
  uncollected?: boolean;
  hasNotes?: boolean;
  hasLyrics?: boolean;
  hasImage?: boolean;
  hasAudio?: boolean;
  hasSessions?: boolean;
  archived?: ArchivedScope;
};

/**
 * Query parameters `GET /projects/:id/tracks/paginated` takes. Loose, so the
 * `cf_<id>` filters a project's own fields add reach the page.
 */
export const trackQuerySchema = paginationQuerySchema
  .extend({
    ...trackFilterSchema.shape,
    ...trackAuditFilterSchema.shape,
    archived: archivedScopeSchema.optional(),
  })
  .loose();

export type TrackQuery = z.infer<typeof trackQuerySchema>;

/**
 * The archived scope of a track listing: live tracks unless `only` asks for
 * the archived ones or `include` for both.
 */
function trackArchivedScope(scope: ArchivedScope | undefined): SQL | undefined {
  if (scope === "include") return undefined;
  return scope === "only"
    ? isNotNull(tracks.archivedAt)
    : isNull(tracks.archivedAt);
}

/** `label` matches tracks carrying that label id. */
function labelFilterSql(labelId: number | undefined): SQL | undefined {
  if (labelId == null) return undefined;
  return sql`exists (select 1 from ${entityLabels} where ${entityLabels.entityType} = 'track' and ${entityLabels.entityId} = ${tracks.id} and ${entityLabels.labelId} = ${labelId})`;
}

/** `artist` matches an exact member of the track's `artists` array. */
function artistFilterSql(artist: string | undefined): SQL | undefined {
  if (!artist) return undefined;
  return sql`${tracks.artists} @> ${JSON.stringify([artist])}::jsonb`;
}

/** How many of the tracks `where` admits credit each artist, keyed by name. */
function artistCounts(where: SQL | undefined) {
  return db
    .select({
      key: sql<string>`artist.value`,
      value: sql<number>`count(distinct ${tracks.id})`,
    })
    .from(tracks)
    .innerJoin(
      sql`jsonb_array_elements_text(${tracks.artists}) as artist(value)`,
      sql`true`
    )
    .where(where)
    .groupBy(sql`artist.value`);
}

/**
 * Every artist credited on a project's tracks, archived ones included, most
 * credited first and then by name. It is the vocabulary a track's artist
 * picker suggests from, so a credit reuses an existing spelling rather than
 * splitting the `artist` filter across two.
 */
export async function getProjectArtists(projectId: number): Promise<string[]> {
  const rows = await artistCounts(eq(tracks.projectId, projectId)).orderBy(
    desc(sql`count(distinct ${tracks.id})`),
    asc(sql`artist.value`)
  );
  return rows.map((row) => row.key);
}

function explicitFilterSql(explicit: boolean | undefined): SQL | undefined {
  return explicit == null ? undefined : eq(tracks.explicit, explicit);
}

function collectionFilterSql(
  collectionId: number | undefined
): SQL | undefined {
  if (collectionId == null) return undefined;
  return sql`exists (select 1 from ${collectionTracks} where ${collectionTracks.trackId} = ${tracks.id} and ${collectionTracks.collectionId} = ${collectionId})`;
}

/**
 * `relation=any` matches tracks that touch any relation row on either end;
 * `relation=<type id>` narrows that to one relation type.
 */
function relationFilterSql(
  relation: RelationFilter | undefined
): SQL | undefined {
  if (relation === undefined) return undefined;
  const typePredicate =
    relation === "any"
      ? sql``
      : sql` and ${trackRelations.relationTypeId} = ${relation}`;
  return sql`exists (select 1 from ${trackRelations} where (${trackRelations.fromTrackId} = ${tracks.id} or ${trackRelations.toTrackId} = ${tracks.id})${typePredicate})`;
}

/** True when `tracks.notes` holds a non-empty JSON block array. */
const trackHasNotesSql = sql<boolean>`coalesce(jsonb_typeof(${tracks.notes}) = 'array' and jsonb_array_length(${tracks.notes}) > 0, false)`;

const trackHasLabelsSql = sql<boolean>`exists (select 1 from ${entityLabels} where ${entityLabels.entityType} = 'track' and ${entityLabels.entityId} = ${tracks.id})`;
const trackHasCollectionSql = sql<boolean>`exists (select 1 from ${collectionTracks} where ${collectionTracks.trackId} = ${tracks.id})`;
const trackHasLyricsSql = sql<boolean>`exists (select 1 from ${notes} where ${notes.trackId} = ${tracks.id})`;
const trackHasAudioSql = sql<boolean>`exists (select 1 from ${trackAudios} where ${trackAudios.trackId} = ${tracks.id})`;
const trackHasSessionsSql = sql<boolean>`exists (select 1 from ${sessions} where ${sessions.trackId} = ${tracks.id})`;

function booleanPredicateSql(
  flag: boolean | undefined,
  whenTrue: SQL
): SQL | undefined {
  if (flag == null) return undefined;
  return flag ? whenTrue : sql`not (${whenTrue})`;
}

function unlabeledFilterSql(unlabeled: boolean | undefined): SQL | undefined {
  if (unlabeled == null) return undefined;
  return unlabeled ? sql`not (${trackHasLabelsSql})` : trackHasLabelsSql;
}

function uncollectedFilterSql(
  uncollected: boolean | undefined
): SQL | undefined {
  if (uncollected == null) return undefined;
  return uncollected
    ? sql`not (${trackHasCollectionSql})`
    : trackHasCollectionSql;
}

function hasImageFilterSql(hasImage: boolean | undefined): SQL | undefined {
  if (hasImage == null) return undefined;
  return hasImage ? isNotNull(tracks.image) : isNull(tracks.image);
}

/** The `where` predicate shared by the tracks page query and the bulk writes. */
function tracksWhere(projectId: number, f: TrackFilters): SQL | undefined {
  return and(
    eq(tracks.projectId, projectId),
    trackArchivedScope(f.archived),
    f.q ? ilike(tracks.title, `%${escapeLikeTerm(f.q)}%`) : undefined,
    statusFilterSql(tracks.statusId, f.status),
    membershipFilterSql(tracks.priorityId, f.priority),
    collectionFilterSql(f.collection),
    relationFilterSql(f.relation),
    labelFilterSql(f.label),
    artistFilterSql(f.artist),
    explicitFilterSql(f.explicit),
    unlabeledFilterSql(f.unlabeled),
    uncollectedFilterSql(f.uncollected),
    booleanPredicateSql(f.hasNotes, trackHasNotesSql),
    booleanPredicateSql(f.hasLyrics, trackHasLyricsSql),
    hasImageFilterSql(f.hasImage),
    booleanPredicateSql(f.hasAudio, trackHasAudioSql),
    booleanPredicateSql(f.hasSessions, trackHasSessionsSql)
  );
}

export async function getTracksPage(
  projectId: number,
  query: TrackQuery
): Promise<Paginated<ListTrack>> {
  const { page, pageSize } = query;
  const fields = await fieldListing("track", projectId, query);
  const sort = parseSort(query.sort, [...trackSortKeys, ...fields.sortKeys]);

  const base = and(
    eq(tracks.projectId, projectId),
    trackArchivedScope(query.archived)
  );
  // Every active filter, tagged with the dimension it narrows. The rows apply
  // all of them; a facet applies all but its own dimension's, so it keeps
  // counting the options its own filter would otherwise hide.
  const filters: { dimension: string; where: SQL | undefined }[] = [
    {
      dimension: "q",
      where: query.q
        ? ilike(tracks.title, `%${escapeLikeTerm(query.q)}%`)
        : undefined,
    },
    {
      dimension: "status",
      where: statusFilterSql(tracks.statusId, query.status),
    },
    {
      dimension: "priority",
      where: membershipFilterSql(tracks.priorityId, query.priority),
    },
    { dimension: "collection", where: collectionFilterSql(query.collection) },
    { dimension: "relation", where: relationFilterSql(query.relation) },
    { dimension: "label", where: labelFilterSql(query.label) },
    { dimension: "artist", where: artistFilterSql(query.artist) },
    { dimension: "explicit", where: explicitFilterSql(query.explicit) },
    { dimension: "unlabeled", where: unlabeledFilterSql(query.unlabeled) },
    {
      dimension: "uncollected",
      where: uncollectedFilterSql(query.uncollected),
    },
    {
      dimension: "hasNotes",
      where: booleanPredicateSql(query.hasNotes, trackHasNotesSql),
    },
    {
      dimension: "hasLyrics",
      where: booleanPredicateSql(query.hasLyrics, trackHasLyricsSql),
    },
    { dimension: "hasImage", where: hasImageFilterSql(query.hasImage) },
    {
      dimension: "hasAudio",
      where: booleanPredicateSql(query.hasAudio, trackHasAudioSql),
    },
    {
      dimension: "hasSessions",
      where: booleanPredicateSql(query.hasSessions, trackHasSessionsSql),
    },
    { dimension: "fields", where: fields.where() },
  ];
  const whereExcept = (dimension?: string) =>
    and(
      base,
      ...filters.filter((f) => f.dimension !== dimension).map((f) => f.where)
    );
  const where = whereExcept();

  // A collection is an ordered tracklist, so its own page defaults to track
  // order rather than the recency default the unscoped listing uses.
  const collectionNumberSql = sql`(select ${collectionTracks.trackNumber} from ${collectionTracks} where ${collectionTracks.trackId} = ${tracks.id} and ${collectionTracks.collectionId} = ${query.collection})`;
  const defaultOrderKey =
    query.collection != null ? collectionNumberSql : tracks.updatedAt;
  const fieldSort = sort ? fields.sort(sort.key) : undefined;
  const orderKey = sort
    ? (fieldSort?.order ??
      (sort.key === "trackNumber"
        ? collectionNumberSql
        : trackSortColumns[sort.key as keyof typeof trackSortColumns]))
    : defaultOrderKey;
  const group = query.groupBy
    ? (ownGroupKey(trackGroupKeys, query.groupBy) ??
      fields.group(query.groupBy) ??
      null)
    : null;
  const expandedGroup = query.groupBy
    ? (ownGroupKey(trackExpandedGroupKeys, query.groupBy) ?? null)
    : null;
  const sortJoins = sort
    ? (fieldSort?.joins ??
      trackSortJoins[sort.key as keyof typeof trackSortColumns] ??
      [])
    : [];
  const sortSql = [
    sortTerm(orderKey, sort?.desc ?? false),
    sql`${asc(tracks.id)}`,
  ];

  const pageIds = async (): Promise<number[]> => {
    if (expandedGroup) {
      const pairs = await expandedGroupedIdRows(
        tracks,
        tracks.id,
        expandedGroup,
        where,
        sortSql,
        sortJoins
      );
      return [...new Set(pairs.map((p) => p.id))];
    }
    if (group) {
      return groupedIdRows(tracks, tracks.id, group, where, sortSql, sortJoins);
    }
    const idRows = await withJoins(
      db.select({ id: tracks.id }).from(tracks).$dynamic(),
      sortJoins
    )
      .where(where)
      .orderBy(...sortSql)
      .limit(pageSize)
      .offset(offsetOf(page, pageSize));
    return idRows.map((r) => r.id);
  };

  // The total and the id page read the same `where` but neither needs the
  // other's result, so they go out together.
  const [ids, countRows] = await Promise.all([
    pageIds(),
    db.select({ value: count() }).from(tracks).where(where),
  ]);
  const rowCount = countRows[0]?.value ?? 0;
  // Only the fields the listing itself renders — see `listTrackSchema`. The
  // notes document, the attachments and the audio rows belong to the track
  // page; a page of 50 tracks would carry 50 sets of them for cells that do
  // not exist. Full session rows are fetched per track when its sub-rows are
  // expanded.
  const hydrated = await hydratePage(ids, (ids) =>
    db.query.tracks.findMany({
      where: { id: { in: ids } },
      columns: {
        notes: false,
        notesText: false,
      },
      with: {
        status: true,
        priority: { columns: priorityLevelColumns },
        collections: { columns: { id: true, title: true, image: true } },
        sessions: {
          columns: {
            id: true,
            name: true,
            trackId: true,
            main: true,
            rootNote: true,
            scale: true,
            tempo: true,
          },
        },
        primaryAudio: { columns: { lufs: true, duplicateOfId: true } },
      },
    })
  );
  const hydratedIds = hydrated.map((r) => r.id);
  // A duplicate always names another version of the same track (A7 aligns a
  // track's own other versions against each other), so the table's badge
  // only needs the version number, not a second track lookup.
  const duplicateOfIds = [
    ...new Set(
      hydrated.flatMap((row) =>
        row.primaryAudio?.duplicateOfId != null
          ? [row.primaryAudio.duplicateOfId]
          : []
      )
    ),
  ];
  const duplicateVersionsQuery =
    duplicateOfIds.length > 0
      ? db
          .select({ id: trackAudios.id, version: trackAudios.version })
          .from(trackAudios)
          .where(inArray(trackAudios.id, duplicateOfIds))
      : Promise.resolve([]);
  // A track's number belongs to its membership of one collection, not to the
  // track, so it only exists on a page scoped to a collection.
  const numberRowsQuery =
    query.collection != null && ids.length > 0
      ? db
          .select({
            trackId: collectionTracks.trackId,
            trackNumber: collectionTracks.trackNumber,
          })
          .from(collectionTracks)
          .where(
            and(
              eq(collectionTracks.collectionId, query.collection),
              inArray(collectionTracks.trackId, ids)
            )
          )
      : Promise.resolve([]);

  const hasNotesRowsQuery =
    hydratedIds.length > 0
      ? db
          .select({ id: tracks.id })
          .from(tracks)
          .where(and(inArray(tracks.id, hydratedIds), trackHasNotesSql))
      : Promise.resolve([]);
  const lyricsRowsQuery =
    hydratedIds.length > 0
      ? db
          .select({ trackId: notes.trackId })
          .from(notes)
          .where(inArray(notes.trackId, hydratedIds))
      : Promise.resolve([]);
  const audioCountRowsQuery =
    hydratedIds.length > 0
      ? db
          .select({ trackId: trackAudios.trackId, audioCount: count() })
          .from(trackAudios)
          .where(inArray(trackAudios.trackId, hydratedIds))
          .groupBy(trackAudios.trackId)
      : Promise.resolve([]);

  const [
    labelsByTrack,
    numberRows,
    relationsByTrack,
    duplicateVersionRows,
    saveStats,
    fieldValues,
    hasNotesRows,
    lyricsRows,
    audioCountRows,
  ] = await Promise.all([
    getEntityLabelsBatch("track", hydratedIds),
    numberRowsQuery,
    getTrackRelationEdgesBatch(hydratedIds),
    duplicateVersionsQuery,
    trackSaveStats(hydratedIds),
    valuesFor("track", hydratedIds),
    hasNotesRowsQuery,
    lyricsRowsQuery,
    audioCountRowsQuery,
  ]);

  const trackNumbers = new Map<number, number | null>(
    numberRows.map((r) => [r.trackId, r.trackNumber])
  );
  const duplicateVersions = new Map<number, number>(
    duplicateVersionRows.map((r) => [r.id, r.version])
  );
  const tracksWithNotes = new Set<number>(hasNotesRows.map((r) => r.id));
  const tracksWithLyrics = new Set<number>(
    lyricsRows.flatMap((r) => (r.trackId != null ? [r.trackId] : []))
  );
  const audioCounts = new Map<number, number>(
    audioCountRows.map((r) => [r.trackId, r.audioCount])
  );
  const rows = hydrated.map(({ primaryAudio, ...row }) => ({
    ...row,
    lufs: primaryAudio?.lufs ?? null,
    duplicateOfVersion:
      primaryAudio?.duplicateOfId != null
        ? (duplicateVersions.get(primaryAudio.duplicateOfId) ?? null)
        : null,
    lastSaveAt: saveStats.get(row.id)?.lastSaveAt ?? null,
    saveCount: saveStats.get(row.id)?.saveCount ?? 0,
    hasNotes: tracksWithNotes.has(row.id),
    hasLyrics: tracksWithLyrics.has(row.id),
    audioCount: audioCounts.get(row.id) ?? 0,
    ...deriveTrackMusicMeta(row.sessions),
    relations: relationsByTrack.get(row.id) ?? [],
    labels: labelsByTrack.get(row.id) ?? [],
    ...(query.collection != null
      ? { trackNumber: trackNumbers.get(row.id) ?? null }
      : {}),
    fields: fieldValues.get(row.id) ?? {},
  }));

  // Each facet counts a different column against its own filter set, so all
  // of them go out as one round.
  const [
    status,
    priority,
    collectionRows,
    relationRows,
    anyRelationRows,
    labelRows,
    artistRows,
    explicit,
    fieldFacets,
  ] = await Promise.all([
    facetCounts(tracks.statusId, tracks, whereExcept("status")),
    facetCounts(tracks.priorityId, tracks, whereExcept("priority")),
    db
      .select({ key: collectionTracks.collectionId, value: count() })
      .from(collectionTracks)
      .innerJoin(tracks, eq(collectionTracks.trackId, tracks.id))
      .where(whereExcept("collection"))
      .groupBy(collectionTracks.collectionId),
    db
      .select({
        key: trackRelations.relationTypeId,
        value: sql<number>`count(distinct ${tracks.id})`,
      })
      .from(trackRelations)
      .innerJoin(
        tracks,
        or(
          eq(trackRelations.fromTrackId, tracks.id),
          eq(trackRelations.toTrackId, tracks.id)
        )
      )
      .where(whereExcept("relation"))
      .groupBy(trackRelations.relationTypeId),
    db
      .select({ value: sql<number>`count(distinct ${tracks.id})` })
      .from(trackRelations)
      .innerJoin(
        tracks,
        or(
          eq(trackRelations.fromTrackId, tracks.id),
          eq(trackRelations.toTrackId, tracks.id)
        )
      )
      .where(whereExcept("relation")),
    db
      .select({ key: entityLabels.labelId, value: count() })
      .from(entityLabels)
      .innerJoin(tracks, eq(entityLabels.entityId, tracks.id))
      .where(and(eq(entityLabels.entityType, "track"), whereExcept("label")))
      .groupBy(entityLabels.labelId),
    artistCounts(whereExcept("artist")),
    facetCounts(tracks.explicit, tracks, whereExcept("explicit")),
    // Each field facet leaves out its own field's filter itself.
    fields.facets(whereExcept("fields")),
  ]);

  const collection: Record<string, number> = {};
  for (const r of collectionRows) collection[String(r.key)] = r.value;

  const relation: Record<string, number> = {};
  for (const r of relationRows) relation[String(r.key)] = Number(r.value);
  const anyRelation = Number(anyRelationRows[0]?.value ?? 0);
  if (anyRelation > 0) relation.any = anyRelation;

  const label: Record<string, number> = {};
  for (const r of labelRows) label[String(r.key)] = Number(r.value);
  const artist: Record<string, number> = {};
  for (const r of artistRows) artist[String(r.key)] = Number(r.value);

  const facets: Facets = {
    status,
    priority,
    collection,
    relation,
    label,
    artist,
    explicit,
    ...fieldFacets,
  };

  const groups = expandedGroup
    ? await expandedGroupSummaries(tracks, tracks.id, expandedGroup, where)
    : group
      ? await groupSummaries(tracks, group, where)
      : [];

  return { rows, rowCount, page, pageSize, facets, groups };
}

/** A selection's `relation` filter, ignored unless it is `any` or a type id. */
function relationFilterValue(
  raw: string | number | undefined
): RelationFilter | undefined {
  return relationFilterSchema.safeParse(selectionString(raw)).data;
}

/** A selection's boolean filter, ignored unless it is `true` or `false`. */
function booleanFilterValue(
  raw: string | number | undefined
): boolean | undefined {
  const value = selectionString(raw);
  return value === "true" ? true : value === "false" ? false : undefined;
}

/**
 * An `all: true` selection carries the page's filters, `archived` among them,
 * and an unparseable scope falls back to live tracks. An id list names its
 * rows outright, so it reaches them whether they are archived or not.
 */
function trackSelectionFilters(selection: BulkSelection): TrackFilters {
  if (!("all" in selection)) return { archived: "include" };
  const f = selectionFilters(selection);
  return {
    archived: archivedScopeSchema.safeParse(f.archived).data,
    q: selectionString(f.q),
    status: selectionNumber(f.status),
    priority: selectionIds(f.priority),
    collection: selectionNumber(f.collection),
    relation: relationFilterValue(f.relation),
    label: selectionNumber(f.label),
    artist: selectionString(f.artist),
    explicit: booleanFilterValue(f.explicit),
    unlabeled: booleanFilterValue(f.unlabeled),
    uncollected: booleanFilterValue(f.uncollected),
    hasNotes: booleanFilterValue(f.hasNotes),
    hasLyrics: booleanFilterValue(f.hasLyrics),
    hasImage: booleanFilterValue(f.hasImage),
    hasAudio: booleanFilterValue(f.hasAudio),
    hasSessions: booleanFilterValue(f.hasSessions),
  };
}

/** The rows a selection names: its built-in filters and its `cf_<id>` ones. */
async function trackSelectionWhere(
  projectId: number,
  selection: BulkSelection
): Promise<SQL | undefined> {
  return selectionScope(
    tracks.id,
    selection,
    and(
      tracksWhere(projectId, trackSelectionFilters(selection)),
      await fieldFilterWhere("track", projectId, selectionFilters(selection))
    )
  );
}

export async function bulkUpdateTracks(
  projectId: number,
  selection: BulkSelection,
  patch: Partial<NewTrack>,
  actorId: string
): Promise<{ updated: number }> {
  const where = await trackSelectionWhere(projectId, selection);
  const before = await db.select().from(tracks).where(where);
  const beforeById = new Map(before.map((row) => [row.id, row]));

  const updated = await db.update(tracks).set(patch).where(where).returning();

  await recordActivityDiffs(
    updated.map((after) => ({
      projectId,
      entityType: "track" as const,
      entityId: after.id,
      userId: actorId,
      before: beforeById.get(after.id) ?? after,
      after,
    }))
  );

  return { updated: updated.length };
}

/**
 * Archive (or unarchive) the given tracks. Only rows not already in the target
 * state are written, so the answer names exactly the tracks that changed, and
 * `sessionCount` is how many sessions ride along with them.
 */
export async function setTracksArchived(
  ids: number[],
  archived: boolean
): Promise<{ ids: number[]; sessionCount: number }> {
  if (ids.length === 0) return { ids: [], sessionCount: 0 };

  const changed = await db
    .update(tracks)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(
        inArray(tracks.id, ids),
        archived ? isNull(tracks.archivedAt) : isNotNull(tracks.archivedAt)
      )
    )
    .returning({ id: tracks.id });
  const changedIds = changed.map((row) => row.id).sort((a, b) => a - b);
  if (changedIds.length === 0) return { ids: [], sessionCount: 0 };

  const [row] = await db
    .select({ n: count() })
    .from(sessions)
    .where(inArray(sessions.trackId, changedIds));
  return { ids: changedIds, sessionCount: row?.n ?? 0 };
}

export async function selectTrackIds(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = await trackSelectionWhere(projectId, selection);
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(where)
    .orderBy(asc(tracks.id));
  return rows.map((row) => row.id);
}

export async function bulkDeleteTracks(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = await trackSelectionWhere(projectId, selection);

  // Read before the delete cascades the selected tracks' versions away, the
  // same as the single-track delete above.
  const spectrogramKeys = await spectrogramKeysForTracksMatching(where);

  const ids = await deleteSelected("track", async (tx) => {
    const selected = await tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(where)
      .orderBy(asc(tracks.id));
    const selectedIds = selected.map((row) => row.id);
    await lockTrackVersions(tx, selectedIds);

    return tx
      .delete(tracks)
      .where(inArray(tracks.id, selectedIds))
      .returning({ id: tracks.id });
  });

  // As in the single delete: the cascaded versions' spectrogram bytes are only
  // recoverable by re-deriving the project's counter.
  await recomputeUsage([projectScope(projectId)]);

  for (const key of spectrogramKeys) await removeStoredFile(key);

  return ids;
}

export const trackSummarySchema = trackSchema
  .pick({
    id: true,
    title: true,
    image: true,
    statusId: true,
    updatedAt: true,
    archivedAt: true,
  })
  .extend({
    artists: z.array(z.string()),
    /** Derived from the track's sessions, the same way the detail routes do. */
    bpm: z.string().nullable(),
    key: z.string().nullable(),
    keyTonic: z.string().nullable(),
    keyScale: z.string().nullable(),
    artwork: artworkSchema.nullable(),
  });

export type TrackSummary = z.infer<typeof trackSummarySchema>;

/** Every track in a project as the pickers and "recently edited" lists read it. */
export async function getTrackSummaries(
  projectId: number
): Promise<TrackSummary[]> {
  const rows = await db.query.tracks.findMany({
    where: { projectId },
    columns: {
      id: true,
      title: true,
      artists: true,
      image: true,
      statusId: true,
      updatedAt: true,
      archivedAt: true,
    },
    // Only the four columns `deriveTrackMusicMeta` reads — the same subset the
    // paginated tracks listing hydrates.
    with: {
      sessions: {
        columns: { main: true, rootNote: true, scale: true, tempo: true },
      },
      // The covers a track without its own falls back to before the project's.
      collections: { columns: { id: true, image: true } },
    },
    // Live tracks first, each group newest first.
    orderBy: (t, { sql }) => [
      sql`${t.archivedAt} is not null`,
      sql`${t.updatedAt} desc`,
    ],
  });

  const artwork = await artworkForTracks(
    rows.map((row) => ({ ...row, projectId }))
  );
  return rows.map((row, i) => ({
    id: row.id,
    title: row.title,
    artists: row.artists,
    image: row.image,
    statusId: row.statusId,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    ...deriveTrackMusicMeta(row.sessions),
    artwork: artwork[i] ?? null,
  }));
}

export const quietTrackSchema = trackSchema
  .pick({ id: true, title: true })
  .extend({
    artists: z.array(z.string()),
    artwork: artworkSchema.nullable(),
    status: statusSchema
      .pick({ name: true, colourHex: true, percentage: true })
      .nullable(),
    /** The newest of the track's last save, its `updated_at` and its last render linked. */
    lastTouchedAt: z.date(),
  });

export type QuietTrack = z.infer<typeof quietTrackSchema>;

/**
 * The live, unfinished tracks of a project nobody has touched since `before`,
 * oldest touch first. `total` counts every such track, not just the `limit`
 * returned. A track with no status is not done; `greatest` skips a null arm,
 * so a track with no saves and no renders falls back to `updated_at`.
 */
export async function getQuietTracks(
  projectId: number,
  opts: { before: Date; limit: number }
): Promise<{ tracks: QuietTrack[]; total: number }> {
  const lastRenderLinkedAt = sql`(select max(${trackAudios.createdAt}) from ${trackAudios} where ${trackAudios.trackId} = ${tracks.id})`;
  const lastTouchedAt =
    sql<Date>`greatest(${trackLastSaveAt}, ${tracks.updatedAt}, ${lastRenderLinkedAt})`.mapWith(
      tracks.updatedAt
    );

  const rows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artists: tracks.artists,
      image: tracks.image,
      projectId: tracks.projectId,
      statusId: tracks.statusId,
      statusName: statuses.name,
      statusColourHex: statuses.colourHex,
      statusPercentage: statuses.percentage,
      lastTouchedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(tracks)
    .leftJoin(statuses, eq(statuses.id, tracks.statusId))
    .where(
      and(
        eq(tracks.projectId, projectId),
        isNull(tracks.archivedAt),
        sql`coalesce(${statuses.percentage}, 0) < 100`,
        // A raw expression has no column encoder, so bind `before` through one:
        // a bare Date goes out as local time and moves the cutoff by the zone.
        lt(lastTouchedAt, sql.param(opts.before, tracks.updatedAt))
      )
    )
    .orderBy(sql`${lastTouchedAt} asc`, tracks.id)
    .limit(opts.limit);

  const withCollections = await db.query.tracks.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    columns: { id: true },
    with: { collections: { columns: { id: true, image: true } } },
  });
  const collectionsById = new Map(
    withCollections.map((row) => [row.id, row.collections])
  );
  const artwork = await artworkForTracks(
    rows.map((row) => ({
      image: row.image,
      projectId: row.projectId,
      collections: collectionsById.get(row.id),
    }))
  );

  return {
    tracks: rows.map((row, i) => ({
      id: row.id,
      title: row.title,
      artists: row.artists,
      artwork: artwork[i] ?? null,
      // The three status columns are null together, when the track has none.
      status:
        row.statusName === null ||
        row.statusColourHex === null ||
        row.statusPercentage === null
          ? null
          : {
              name: row.statusName,
              colourHex: row.statusColourHex,
              percentage: row.statusPercentage,
            },
      lastTouchedAt: row.lastTouchedAt,
    })),
    total: rows[0]?.total ?? 0,
  };
}
