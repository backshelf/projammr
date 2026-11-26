import {
  and,
  asc,
  count,
  desc,
  eq,
  getColumns,
  ilike,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  VERSIONS_TO_PLAY,
  type VersionToPlay,
} from "@workspace/settings/groups/playback";
import { db, type Tx } from "../../db/index.js";
import {
  recordActivity,
  recordActivityDiffs,
} from "../../db/queries/activity.js";
import {
  artworkForCollection,
  artworkForProjectRows,
  artworkForTracks,
  artworkSchema,
  withArtwork,
} from "../../db/queries/artwork.js";
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
  type BulkSelection,
  deleteSelected,
  escapeLikeTerm,
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
import type { SharelinkTrack } from "../../db/queries/sharelinks.js";
import {
  audioOwnersForTracks,
  audioOwnerSchema,
} from "../../db/queries/track-audios.js";
import {
  assets,
  assetSchema,
  attachedAssetSchema,
  attachmentsWithUploadedBy,
} from "../../db/schema/assets.js";
import {
  type Collection,
  collections,
  collectionSchema,
  collectionTracks,
  type NewCollection,
} from "../../db/schema/collections.js";
import { commentSchema } from "../../db/schema/comments.js";
import { labelSchema } from "../../db/schema/labels.js";
import {
  priorityLevels,
  priorityLevelSchema,
} from "../../db/schema/priority-levels.js";
import { statuses, statusSchema } from "../../db/schema/statuses.js";
import {
  sharedTrackAudioColumns,
  trackAudios,
  tracks,
  trackSchema,
} from "../../db/schema/tracks.js";
import { nullsToUndefined } from "../../lib/utils.js";
import { collectionFilterSchema } from "./filters.js";

/** A track as a collection's tracklist carries it, without its documents. */
const tracklistTrackSchema = trackSchema.omit({
  notes: true,
  notesText: true,
});

const getCollectionSchema = withFieldValues(
  collectionSchema.extend({
    attachments: z.array(attachedAssetSchema),
    status: statusSchema,
    priority: priorityLevelSchema,
    tracks: z.array(tracklistTrackSchema),
    comments: z.array(commentSchema),
    labels: z.array(labelSchema),
  })
);

/**
 * A track as a listed collection draws it in its sub-rows: a link, a cover and
 * a priority badge.
 */
const listCollectionTrackSchema = trackSchema
  .pick({ id: true, title: true, image: true })
  .extend({ priority: priorityLevelSchema });

/**
 * A collection as a listing returns it. The notes document, the comment
 * threads and the attachments belong to the collection page; a listing shows
 * none of them and would carry one set per row.
 */
export const listCollectionSchema = withFieldValues(
  collectionSchema.omit({ notes: true, notesText: true }).extend({
    status: statusSchema.nullable(),
    priority: priorityLevelSchema,
    tracks: z.array(listCollectionTrackSchema),
    labels: z.array(labelSchema),
  })
);

export type ListCollection = z.infer<typeof listCollectionSchema>;

/** A collection with everything its page reads. */
export const collectionDetailSchema = withArtwork(getCollectionSchema);

export type CollectionDetail = z.infer<typeof collectionDetailSchema>;

export async function getCollection(
  collectionId: number
): Promise<CollectionDetail> {
  const result = await db.query.collections.findFirst({
    where: {
      id: collectionId,
    },
    with: {
      attachments: attachmentsWithUploadedBy,
      status: true,
      priority: { columns: priorityLevelColumns },
      // A collection renders a tracklist, never a track's documents, so the
      // notes body stays out of the payload.
      tracks: {
        columns: {
          notes: false,
          notesText: false,
        },
      },
      comments: true,
    },
  });

  if (!result) {
    throw new HTTPException(404, { message: "Collection not found" });
  }

  return {
    ...result,
    labels: await getEntityLabels("collection", collectionId),
    artwork: await artworkForCollection(result),
    fields: await fieldBagOf("collection", collectionId),
  };
}

export const tracksInCollectionSchema = z.array(
  z.object({
    id: z.number(),
    title: z.string(),
    artists: z.array(z.string()),
    archivedAt: z.date().nullable(),
    trackNumber: z.number().nullable(),
    primaryAudio: assetSchema.nullable(),
    status: statusSchema.nullable(),
  })
);

export type TrackInCollection = z.infer<
  typeof tracksInCollectionSchema
>[number];

export async function getSharelinkTracksInCollection(
  collectionId: number
): Promise<SharelinkTrack[]> {
  const preLinks = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      position: collectionTracks.trackNumber,
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
    .leftJoin(collectionTracks, eq(tracks.id, collectionTracks.trackId))
    .leftJoin(collections, eq(collections.id, collectionTracks.collectionId))
    .leftJoin(
      trackAudios,
      and(eq(tracks.id, trackAudios.trackId), eq(trackAudios.isPrimary, true))
    )
    .leftJoin(assets, eq(trackAudios.assetId, assets.id))
    .leftJoin(statuses, eq(tracks.statusId, statuses.id))
    .where(and(eq(collections.id, collectionId)))
    .orderBy(sql`${collectionTracks.trackNumber} NULLS LAST`, tracks.id);

  return preLinks.map((pre) => nullsToUndefined(pre));
}

export async function getTracksInCollection(
  collectionId: number
): Promise<TrackInCollection[]> {
  return db
    .select({
      id: tracks.id,
      title: tracks.title,
      artists: tracks.artists,
      archivedAt: tracks.archivedAt,
      trackNumber: collectionTracks.trackNumber,
      primaryAudio: {
        ...getColumns(assets),
      },
      status: {
        ...getColumns(statuses),
      },
    })
    .from(tracks)
    .leftJoin(collectionTracks, eq(tracks.id, collectionTracks.trackId))
    .leftJoin(collections, eq(collections.id, collectionTracks.collectionId))
    .leftJoin(
      trackAudios,
      and(eq(tracks.id, trackAudios.trackId), eq(trackAudios.isPrimary, true))
    )
    .leftJoin(assets, eq(trackAudios.assetId, assets.id))
    .leftJoin(statuses, eq(tracks.statusId, statuses.id))
    .where(and(eq(collections.id, collectionId)))
    .orderBy(sql`${collectionTracks.trackNumber} NULLS LAST`, tracks.id);
}
export const collectionPrimaryAudiosSchema = z.array(
  assetSchema.extend({
    trackId: z.number(),
    trackNumber: z.number().nullable(),
    trackAudio: z.object({
      id: z.number(),
      version: z.number(),
      isPrimary: z.boolean(),
    }),
    owner: audioOwnerSchema.nullable(),
  })
);

export const collectionPrimaryAudiosQuerySchema = z.object({
  version: z.enum(VERSIONS_TO_PLAY).default("primary"),
});

export type CollectionPrimaryAudio = z.infer<
  typeof collectionPrimaryAudiosSchema
>[number];

/**
 * One audio asset per track in the collection, ordered by track number
 * (unnumbered tracks last): the version `version` picks, where `"primary"`
 * falls back to the highest-numbered version for a track with no primary.
 * Tracks with no audio are omitted — the caller queues exactly what comes
 * back.
 */
export async function getCollectionPrimaryAudios(
  collectionId: number,
  version: VersionToPlay
): Promise<CollectionPrimaryAudio[]> {
  const candidate = alias(trackAudios, "candidate_audio");
  const pickedAudioId = db
    .select({ id: candidate.id })
    .from(candidate)
    .where(eq(candidate.trackId, tracks.id))
    .orderBy(
      ...(version === "primary" ? [desc(candidate.isPrimary)] : []),
      desc(candidate.version)
    )
    .limit(1);

  const rows = await db
    .select({
      asset: { ...getColumns(assets) },
      trackId: tracks.id,
      trackNumber: collectionTracks.trackNumber,
      trackAudio: {
        id: trackAudios.id,
        version: trackAudios.version,
        isPrimary: trackAudios.isPrimary,
      },
    })
    .from(collectionTracks)
    .innerJoin(tracks, eq(tracks.id, collectionTracks.trackId))
    .innerJoin(trackAudios, eq(trackAudios.id, pickedAudioId))
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(eq(collectionTracks.collectionId, collectionId))
    .orderBy(sql`${collectionTracks.trackNumber} NULLS LAST`, tracks.id);

  const owners = await audioOwnersForTracks(rows.map((r) => r.trackId));

  return rows.map((r) => ({
    ...r.asset,
    trackId: r.trackId,
    trackNumber: r.trackNumber,
    trackAudio: r.trackAudio,
    owner: owners.get(r.trackId) ?? null,
  }));
}

type Executor = typeof db | Tx;

/** The project a collection belongs to; a collection that is not there 404s. */
async function collectionProjectId(
  exec: Executor,
  collectionId: number
): Promise<number> {
  const [row] = await exec
    .select({ projectId: collections.projectId })
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!row) throw new HTTPException(404, { message: "Collection not found" });
  return row.projectId;
}

/**
 * Track titles in track-number order (unnumbered last), from a set of
 * memberships already read. Kept apart from the query that reads those
 * memberships so a caller inside a transaction that already holds them (a
 * renumbering) does not read `collection_tracks` a second time.
 */
async function orderedTitles(
  exec: Executor,
  memberships: { trackId: number; trackNumber: number | null }[]
): Promise<string[]> {
  if (memberships.length === 0) return [];
  const rows = await exec
    .select({ id: tracks.id, title: tracks.title })
    .from(tracks)
    .where(
      inArray(
        tracks.id,
        memberships.map((m) => m.trackId)
      )
    );
  const titleById = new Map(rows.map((r) => [r.id, r.title]));

  return [...memberships]
    .sort((a, b) => {
      if (a.trackNumber == null) return b.trackNumber == null ? 0 : 1;
      if (b.trackNumber == null) return -1;
      return a.trackNumber - b.trackNumber;
    })
    .map((m) => titleById.get(m.trackId) ?? "");
}

/** A collection's current tracklist, as titles in track-number order. */
async function collectionTrackTitles(
  exec: Executor,
  collectionId: number
): Promise<string[]> {
  const memberships = await exec
    .select({
      trackId: collectionTracks.trackId,
      trackNumber: collectionTracks.trackNumber,
    })
    .from(collectionTracks)
    .where(eq(collectionTracks.collectionId, collectionId));
  return orderedTitles(exec, memberships);
}

/** Logs a collection's tracklist moving from `before` to its current state. */
async function logTracklistChange(
  collectionId: number,
  field: "tracks" | "trackOrder",
  before: string[],
  actorId: string
): Promise<void> {
  await recordActivity({
    projectId: await collectionProjectId(db, collectionId),
    entityType: "collection",
    entityId: collectionId,
    userId: actorId,
    action: "updated",
    before: { [field]: before },
    after: { [field]: await collectionTrackTitles(db, collectionId) },
  });
}

export async function addTrackToCollection(
  trackId: number,
  collectionId: number,
  actorId: string,
  trackNumber?: number
): Promise<typeof collectionTracks.$inferSelect> {
  const before = await collectionTrackTitles(db, collectionId);

  const [result] = await db
    .insert(collectionTracks)
    .values({ trackId, collectionId, trackNumber })
    .onConflictDoNothing()
    .returning();

  if (!result) {
    throw new HTTPException(409, {
      message: "That track is already in this collection",
    });
  }

  await logTracklistChange(collectionId, "tracks", before, actorId);
  return result;
}

/** Body of `POST /collections/:id/tracks/bulk`. */
export const addTracksToCollectionSchema = z.object({
  trackIds: z.array(z.number().int()),
});

export const addedCountSchema = z.object({ added: z.number() });

/**
 * Add many tracks to a collection at once. Existing memberships are left as-is
 * (`onConflictDoNothing`); new rows get no track number, matching the per-row
 * add. Returns how many memberships were created.
 */
export async function bulkAddTracksToCollection(
  collectionId: number,
  trackIds: number[],
  actorId: string
): Promise<{ added: number }> {
  if (trackIds.length === 0) return { added: 0 };

  const before = await collectionTrackTitles(db, collectionId);

  const inserted = await db
    .insert(collectionTracks)
    .values(trackIds.map((trackId) => ({ collectionId, trackId })))
    .onConflictDoNothing()
    .returning({ trackId: collectionTracks.trackId });

  await logTracklistChange(collectionId, "tracks", before, actorId);
  return { added: inserted.length };
}

export async function removeTrackFromCollection(
  collectionId: number,
  trackId: number,
  actorId: string
): Promise<typeof collectionTracks.$inferSelect> {
  const before = await collectionTrackTitles(db, collectionId);

  const [result] = await db
    .delete(collectionTracks)
    .where(
      and(
        eq(collectionTracks.collectionId, collectionId),
        eq(collectionTracks.trackId, trackId)
      )
    )
    .returning();

  if (!result)
    throw new HTTPException(404, { message: "Track not found in collection" });

  await logTracklistChange(collectionId, "tracks", before, actorId);
  return result;
}

/**
 * Creates a collection. A body that leaves out its status gets the project's
 * default one if the project can still use it (the column default if not),
 * one that leaves out its priority gets the project's default level, and the
 * new collection carries the project's default labels it still has, linked in
 * the same transaction as the row.
 */
export async function createCollection(
  collection: DefaultableLevel<NewCollection>
): Promise<Collection> {
  const { defaults } = await projectPolicy(collection.projectId);
  const defaultStatus =
    collection.statusId === undefined &&
    (await isStatusUsable(defaults.collectionStatusId, collection.projectId))
      ? { statusId: defaults.collectionStatusId }
      : {};

  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(collections)
      .values(await withDefaultLevel({ ...collection, ...defaultStatus }, tx))
      .onConflictDoNothing()
      .returning();

    if (!result)
      throw new HTTPException(400, { message: "Collection already exists" });

    await linkLabelsInProject(
      tx,
      result.projectId,
      "collection",
      result.id,
      defaults.labelIds
    );
    return result;
  });
}

export async function deleteCollection(
  collectionId: number
): Promise<Collection> {
  return db.transaction(async (tx) => {
    await clearEntityLabels(tx, "collection", collectionId);
    const [result] = await tx
      .delete(collections)
      .where(eq(collections.id, collectionId))
      .returning();

    if (!result)
      throw new HTTPException(404, { message: "Collection not found" });

    return result;
  });
}

/** The bare collection row, no relations — for diffing before an update. */
export async function getCollectionRow(
  collectionId: number
): Promise<Collection | undefined> {
  const [row] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId));
  return row;
}

export async function updateCollection(
  collectionId: number,
  collection: Partial<NewCollection>
): Promise<Collection> {
  const [result] = await db
    .update(collections)
    .set(collection)
    .where(eq(collections.id, collectionId))
    .returning();

  if (!result)
    throw new HTTPException(404, { message: "Collection not found" });

  return result;
}

export async function updateCollectionStatus(
  collectionId: number,
  status: { statusId: number }
): Promise<Collection> {
  return updateCollection(collectionId, status);
}

/**
 * Reads every membership's number with `FOR UPDATE`. Two concurrent
 * renumberings of one collection would otherwise both read the pre-change
 * numbering under `READ COMMITTED` and interleave into an order neither
 * caller asked for; the lock makes the second re-read after the first commits.
 */
function lockTrackNumbers(tx: Tx, collectionId: number) {
  return tx
    .select({
      trackId: collectionTracks.trackId,
      trackNumber: collectionTracks.trackNumber,
    })
    .from(collectionTracks)
    .where(eq(collectionTracks.collectionId, collectionId))
    .for("update");
}

/**
 * Writes a collection's whole numbering in two statements.
 * `dedupe_track_numbers` is not deferrable, so every number is cleared before
 * the new set is written; the assignment is one `UPDATE ... FROM (VALUES ...)`
 * rather than one statement per membership.
 */
async function applyTrackNumbers(
  tx: Tx,
  collectionId: number,
  numbers: Map<number, number | null>
) {
  await tx
    .update(collectionTracks)
    .set({ trackNumber: null })
    .where(eq(collectionTracks.collectionId, collectionId));

  const pairs = [...numbers].filter(
    (pair): pair is [number, number] => pair[1] != null
  );
  if (pairs.length > 0) {
    await tx.execute(sql`
      update ${collectionTracks} as ct
      set track_number = v.track_number
      from (values ${sql.join(
        pairs.map(([trackId, n]) => sql`(${trackId}::int, ${n}::int)`),
        sql`, `
      )}) as v(track_id, track_number)
      where ct.collection_id = ${collectionId} and ct.track_id = v.track_id
    `);
  }

  return tx
    .select()
    .from(collectionTracks)
    .where(eq(collectionTracks.collectionId, collectionId));
}

/** Body of `PATCH /collections/:id/tracks/:trackId/number`. */
export const trackNumberSchema = z.object({ trackNumber: z.number() });

/**
 * Update a single track's number in a collection.
 * If the new number conflicts with another track, swap them.
 */
export async function updateTrackNumberInCollection(
  collectionId: number,
  trackId: number,
  newNumber: number,
  actorId: string
): Promise<(typeof collectionTracks.$inferSelect)[]> {
  const { before, after, rows } = await db.transaction(async (tx) => {
    const current = await lockTrackNumbers(tx, collectionId);

    const target = current.find((r) => r.trackId === trackId);
    if (!target)
      throw new HTTPException(404, {
        message: "Track not found in collection",
      });

    const conflict = current.find(
      (r) => r.trackId !== trackId && r.trackNumber === newNumber
    );

    const numbers = new Map<number, number | null>(
      current.map((r) => [r.trackId, r.trackNumber])
    );
    numbers.set(trackId, newNumber);
    if (conflict) numbers.set(conflict.trackId, target.trackNumber);

    // Read both orderings inside the transaction the write already opened,
    // off the memberships it already locked, rather than a fresh
    // `collection_tracks` read that could see a third renumbering land
    // in between.
    const rows = await applyTrackNumbers(tx, collectionId, numbers);
    return {
      before: await orderedTitles(tx, current),
      after: await orderedTitles(tx, rows),
      rows,
    };
  });

  await recordActivity({
    projectId: await collectionProjectId(db, collectionId),
    entityType: "collection",
    entityId: collectionId,
    userId: actorId,
    action: "updated",
    before: { trackOrder: before },
    after: { trackOrder: after },
  });

  return rows;
}

export const collectionTrackSummarySchema = z.array(
  z.object({
    id: z.number(),
    title: z.string(),
    trackNumber: z.number().nullable(),
    image: z.string().nullable(),
    archivedAt: z.date().nullable(),
    artwork: artworkSchema.nullable(),
  })
);

export type CollectionTrackSummary = z.infer<
  typeof collectionTrackSummarySchema
>[number];

/**
 * The track titles the sidebar shows under a collection, and nothing more.
 * `getTracksInCollection` carries each track's primary audio and status, which
 * a list of links does not read.
 *
 * A track without a cover of its own falls back to this collection's, not to
 * the lowest-id collection it is on as everywhere else: nested under this one,
 * it reads as part of it.
 */
export async function getCollectionTrackSummaries(
  collectionId: number
): Promise<CollectionTrackSummary[]> {
  const rows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      trackNumber: collectionTracks.trackNumber,
      image: tracks.image,
      archivedAt: tracks.archivedAt,
      projectId: tracks.projectId,
      collectionImage: collections.image,
    })
    .from(collectionTracks)
    .innerJoin(tracks, eq(tracks.id, collectionTracks.trackId))
    .innerJoin(collections, eq(collections.id, collectionTracks.collectionId))
    .where(eq(collectionTracks.collectionId, collectionId))
    .orderBy(sql`${collectionTracks.trackNumber} NULLS LAST`, tracks.id);

  const artwork = await artworkForTracks(
    rows.map((row) => ({
      image: row.image,
      projectId: row.projectId,
      collections: [{ id: collectionId, image: row.collectionImage }],
    }))
  );
  return rows.map((row, i) => ({
    id: row.id,
    title: row.title,
    trackNumber: row.trackNumber,
    image: row.image,
    archivedAt: row.archivedAt,
    artwork: artwork[i] ?? null,
  }));
}

/*
 * The project-scoped collection listing: sort keys, groupings, filters, the
 * paginated page, the bulk writes and the summary list.
 */

export const collectionSortColumns = {
  id: collections.id,
  title: collections.title,
  priority: priorityLevels.rank,
  upc: collections.upc,
  releaseDate: collections.releaseDate,
  status: statuses.percentage,
  createdAt: collections.createdAt,
  updatedAt: collections.updatedAt,
} as const;

const statusJoin: TableJoin = {
  table: statuses,
  on: eq(collections.statusId, statuses.id),
};

const priorityJoin: TableJoin = {
  table: priorityLevels,
  on: eq(collections.priorityId, priorityLevels.id),
};

/**
 * The joins a collection sort key reads beyond `collections`, applied by the
 * plain and the grouped page alike. A key absent here needs none.
 */
const collectionSortJoins: Partial<
  Record<keyof typeof collectionSortColumns, readonly TableJoin[]>
> = {
  status: [statusJoin],
  priority: [priorityJoin],
};

const collectionGroupKeys: Record<string, GroupKey> = {
  status: {
    keyColumn: collections.statusId,
    orderColumn: statuses.percentage,
    labelColumn: statuses.name,
    joins: [statusJoin],
    noneLabel: "No status",
  },
  priority: {
    keyColumn: collections.priorityId,
    orderColumn: priorityLevels.rank,
    labelColumn: priorityLevels.name,
    joins: [priorityJoin],
    noneLabel: "No priority",
  },
};

/** Every key a collection listing groups by. */
export const collectionGroupColumns: readonly string[] =
  Object.keys(collectionGroupKeys);

type CollectionFilters = {
  q?: string;
  status?: number;
  priority?: number[];
};

/**
 * Query parameters `GET /projects/:id/collections/paginated` takes. Loose, so
 * the `cf_<id>` filters a project's own fields add reach the page.
 */
export const collectionQuerySchema = paginationQuerySchema
  .extend(collectionFilterSchema.shape)
  .loose();

export type CollectionQuery = z.infer<typeof collectionQuerySchema>;

function collectionsWhere(
  projectId: number,
  f: CollectionFilters
): SQL | undefined {
  return and(
    eq(collections.projectId, projectId),
    f.q ? ilike(collections.title, `%${escapeLikeTerm(f.q)}%`) : undefined,
    statusFilterSql(collections.statusId, f.status),
    membershipFilterSql(collections.priorityId, f.priority)
  );
}

export async function getCollectionsPage(
  projectId: number,
  query: CollectionQuery
): Promise<Paginated<ListCollection>> {
  const { page, pageSize } = query;
  const fields = await fieldListing("collection", projectId, query);
  const sort = parseSort(query.sort, [
    ...Object.keys(collectionSortColumns),
    ...fields.sortKeys,
  ]);

  const base = eq(collections.projectId, projectId);
  const qFilter = query.q
    ? ilike(collections.title, `%${escapeLikeTerm(query.q)}%`)
    : undefined;
  const statusFilter = statusFilterSql(collections.statusId, query.status);
  const priorityFilter = membershipFilterSql(
    collections.priorityId,
    query.priority
  );
  const fieldFilter = fields.where();
  const where = and(base, qFilter, statusFilter, priorityFilter, fieldFilter);

  const fieldSort = sort ? fields.sort(sort.key) : undefined;
  const orderKey = sort
    ? (fieldSort?.order ??
      collectionSortColumns[sort.key as keyof typeof collectionSortColumns])
    : collections.updatedAt;
  const group = query.groupBy
    ? (ownGroupKey(collectionGroupKeys, query.groupBy) ??
      fields.group(query.groupBy) ??
      null)
    : null;
  const sortJoins = sort
    ? (fieldSort?.joins ??
      collectionSortJoins[sort.key as keyof typeof collectionSortColumns] ??
      [])
    : [];
  const sortSql = [
    sortTerm(orderKey, sort?.desc ?? false),
    sql`${asc(collections.id)}`,
  ];

  const pageIds = async (): Promise<number[]> => {
    if (group) {
      return groupedIdRows(
        collections,
        collections.id,
        group,
        where,
        sortSql,
        sortJoins
      );
    }
    const idRows = await withJoins(
      db.select({ id: collections.id }).from(collections).$dynamic(),
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
    db.select({ value: count() }).from(collections).where(where),
  ]);
  const rowCount = countRows[0]?.value ?? 0;
  // See `listCollectionSchema`: the sub-rows draw a link, a cover and a
  // priority badge per track, and nothing on the collection page's own tabs.
  const hydrated = await hydratePage(ids, (ids) =>
    db.query.collections.findMany({
      where: { id: { in: ids } },
      columns: { notes: false, notesText: false },
      with: {
        status: true,
        priority: { columns: priorityLevelColumns },
        tracks: {
          columns: { id: true, title: true, image: true },
          with: { priority: { columns: priorityLevelColumns } },
        },
      },
    })
  );
  const hydratedIds = hydrated.map((r) => r.id);
  const [labelsByCollection, fieldValues] = await Promise.all([
    getEntityLabelsBatch("collection", hydratedIds),
    valuesFor("collection", hydratedIds),
  ]);
  const rows = hydrated.map((row) => ({
    ...row,
    labels: labelsByCollection.get(row.id) ?? [],
    fields: fieldValues.get(row.id) ?? {},
  }));

  const [status, priority, fieldFacets] = await Promise.all([
    facetCounts(
      collections.statusId,
      collections,
      and(base, qFilter, priorityFilter, fieldFilter)
    ),
    facetCounts(
      collections.priorityId,
      collections,
      and(base, qFilter, statusFilter, fieldFilter)
    ),
    fields.facets(and(base, qFilter, statusFilter, priorityFilter)),
  ]);
  const facets: Facets = { status, priority, ...fieldFacets };

  const groups = group ? await groupSummaries(collections, group, where) : [];

  return { rows, rowCount, page, pageSize, facets, groups };
}

function collectionSelectionFilters(
  selection: BulkSelection
): CollectionFilters {
  const f = selectionFilters(selection);
  return {
    q: selectionString(f.q),
    status: selectionNumber(f.status),
    priority: selectionIds(f.priority),
  };
}

/** The rows a selection names: its built-in filters and its `cf_<id>` ones. */
async function collectionSelectionWhere(
  projectId: number,
  selection: BulkSelection
): Promise<SQL | undefined> {
  return selectionScope(
    collections.id,
    selection,
    and(
      collectionsWhere(projectId, collectionSelectionFilters(selection)),
      await fieldFilterWhere(
        "collection",
        projectId,
        selectionFilters(selection)
      )
    )
  );
}

export async function bulkUpdateCollections(
  projectId: number,
  selection: BulkSelection,
  patch: Partial<NewCollection>,
  actorId: string
): Promise<{ updated: number }> {
  const where = await collectionSelectionWhere(projectId, selection);
  const before = await db.select().from(collections).where(where);
  const beforeById = new Map(before.map((row) => [row.id, row]));

  const updated = await db
    .update(collections)
    .set(patch)
    .where(where)
    .returning();

  await recordActivityDiffs(
    updated.map((after) => ({
      projectId,
      entityType: "collection" as const,
      entityId: after.id,
      userId: actorId,
      before: beforeById.get(after.id) ?? after,
      after,
    }))
  );

  return { updated: updated.length };
}

export async function selectCollectionIds(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = await collectionSelectionWhere(projectId, selection);
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(where)
    .orderBy(asc(collections.id));
  return rows.map((row) => row.id);
}

export async function bulkDeleteCollections(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = await collectionSelectionWhere(projectId, selection);
  return deleteSelected("collection", (tx) =>
    tx.delete(collections).where(where).returning({ id: collections.id })
  );
}

export const collectionSummarySchema = collectionSchema
  .pick({
    id: true,
    title: true,
    image: true,
    projectId: true,
    statusId: true,
    releaseDate: true,
    updatedAt: true,
  })
  .extend({ trackCount: z.number(), artwork: artworkSchema.nullable() });

export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

/** Every collection in a project as the sidebar and pickers read it. */
export async function getCollectionSummaries(
  projectId: number
): Promise<CollectionSummary[]> {
  const rows = await db
    .select({
      id: collections.id,
      title: collections.title,
      image: collections.image,
      projectId: collections.projectId,
      statusId: collections.statusId,
      releaseDate: collections.releaseDate,
      updatedAt: collections.updatedAt,
      trackCount: sql<number>`count(${collectionTracks.trackId})::int`,
    })
    .from(collections)
    .leftJoin(
      collectionTracks,
      eq(collectionTracks.collectionId, collections.id)
    )
    .where(eq(collections.projectId, projectId))
    .groupBy(collections.id)
    .orderBy(collections.title);

  const artwork = await artworkForProjectRows(projectId, rows);
  return rows.map((row, i) => ({ ...row, artwork: artwork[i] ?? null }));
}
