import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, type Tx } from "../../db/index.js";
import {
  replaceSessionSamples,
  heldSampleObjects,
  samplesForSessions,
} from "../../db/queries/session-samples.js";
import { recordActivityDiffs } from "../../db/queries/activity.js";
import {
  getSessionHistory,
  sessionHistorySchema,
} from "../../db/queries/commits.js";
import { artworkForSession, withArtwork } from "../../db/queries/artwork.js";
import { notInProject } from "../../db/queries/authorization.js";
import { openOnFor } from "../../db/queries/machines.js";
import { openOnSchema } from "../../db/schema/machines.js";
import {
  clearEntityLabels,
  getEntityLabels,
  getEntityLabelsBatch,
} from "../../db/queries/labels.js";
import {
  type ArchivedScope,
  archivedScopeSchema,
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
  type TableJoin,
  withJoins,
} from "../../db/queries/pagination.js";
import { projectPolicy } from "../../db/queries/project-policy.js";
import {
  type DefaultableLevel,
  priorityLevelColumns,
  withDefaultLevel,
} from "../../db/queries/priority-levels.js";
import {
  recordRevisions,
  saveFromSession,
  sessionSaveStats,
  sourceOfPatch,
} from "../../db/queries/saves.js";
import {
  assetSchema,
  attachedAssetSchema,
  attachmentsWithUploadedBy,
} from "../../db/schema/assets.js";
import { sessionAttachments } from "../../db/schema/attachments.js";
import { collectionSchema } from "../../db/schema/collections.js";
import { commentSchema } from "../../db/schema/comments.js";
import { labelSchema } from "../../db/schema/labels.js";
import {
  priorityLevels,
  priorityLevelSchema,
} from "../../db/schema/priority-levels.js";
import { saves } from "../../db/schema/saves.js";
import {
  dawIdSchema,
  type NewSession,
  type PluginHost,
  pluginHostSchema,
  type Session,
  sessions,
  sessionSchema,
  type WithSamples,
} from "../../db/schema/sessions.js";
import { sessionSampleSchema } from "../../db/schema/samples.js";
import { tracks, trackSchema } from "../../db/schema/tracks.js";
import { sessionFilterSchema } from "./filters.js";

/**
 * Whether a session's track is archived. A session has no archived state of
 * its own, and one with no track is never archived. A self-contained `EXISTS`
 * on `tracks`, so it also works where a query reads `sessions` with no joins
 * (`facetCounts`).
 */
export const sessionArchived: SQL<boolean> = sql<boolean>`exists (select 1 from ${tracks} where ${tracks.id} = ${sessions.trackId} and ${tracks.archivedAt} is not null)`;

/** A track's main session, named for a caller comparing its own tempo and key against a detected one. */
export const mainSessionSchema = z.object({
  id: z.number(),
  name: z.string(),
  tempo: z.number().nullable(),
  rootNote: z.string().nullable(),
  scale: z.string().nullable(),
});
export type MainSession = z.infer<typeof mainSessionSchema>;

/**
 * The track's main session (the DAW project file its tempo and key live on),
 * or null when it has none. `tempo` is stored `numeric`, so the row reads it
 * back as a string; this converts it to a number for a caller to compare
 * against a detected value.
 */
export async function getMainSessionForTrack(
  trackId: number
): Promise<MainSession | null> {
  const row = await db.query.sessions.findFirst({
    where: { trackId, main: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tempo: row.tempo != null ? Number(row.tempo) : null,
    rootNote: row.rootNote,
    scale: row.scale,
  };
}

/**
 * The project each of a set of session ids belongs to, in one statement. Ids
 * that name no session are absent from the map, so it can be smaller than the
 * input — the caller checks the ids it cares about separately.
 */
export async function projectsBySessionId(
  sessionIds: number[]
): Promise<Map<number, number>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({ id: sessions.id, projectId: sessions.projectId })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds));
  return new Map(rows.map((row) => [row.id, row.projectId]));
}

/**
 * Whether a session whose body leaves `main` out becomes its track's main: it
 * is linked to a track, its project makes a new session the main, and it is
 * new — no session of the project is at its file already, which an upsert
 * would update rather than create.
 */
async function takesMainByDefault(
  tx: Tx,
  session: DefaultableLevel<NewSession>
): Promise<boolean> {
  if (session.main !== undefined || session.trackId == null) return false;
  const { defaults } = await projectPolicy(session.projectId);
  if (!defaults.newSessionMain) return false;
  if (session.localFilepath == null) return true;

  const [held] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, session.projectId),
        eq(sessions.localFilepath, session.localFilepath)
      )
    );
  return held == null;
}

/**
 * Clears a track's main so an incoming session can take it. A main at
 * `exceptFilepath` is left alone: that is the row an upsert is about to
 * write, not the one it replaces.
 */
async function clearTrackMain(
  tx: Tx,
  trackId: number,
  exceptFilepath?: string | null
) {
  await tx
    .update(sessions)
    .set({ main: false })
    .where(
      and(
        eq(sessions.main, true),
        eq(sessions.trackId, trackId),
        exceptFilepath != null
          ? ne(sessions.localFilepath, exceptFilepath)
          : undefined
      )
    );
}

/**
 * Locks `trackIds` `FOR SHARE`, in id order, until `tx` ends, and answers the
 * project each one found is in. Every write that links a session to a track
 * takes this lock before it touches a session row, which is the order a move
 * takes its own locks in (`closeMoveSet`): a write that holds it commits
 * before the move reads the track's sessions, and moves with them, and one
 * that queues behind the move reads the track's new project here.
 */
async function lockTracks(
  tx: Tx,
  trackIds: readonly (number | null | undefined)[]
): Promise<Map<number, number>> {
  const distinct = [...new Set(trackIds.filter((id) => id != null))];
  if (distinct.length === 0) return new Map();
  const rows = await tx
    .select({ id: tracks.id, projectId: tracks.projectId })
    .from(tracks)
    .where(inArray(tracks.id, distinct))
    .orderBy(tracks.id)
    .for("share");
  return new Map(rows.map((row) => [row.id, row.projectId]));
}

/** {@link lockTracks}, refusing a track that is missing or outside `projectId`. */
async function lockTracksIn(
  tx: Tx,
  trackIds: readonly (number | null | undefined)[],
  projectId: number
): Promise<void> {
  const held = await lockTracks(tx, trackIds);
  for (const id of trackIds) {
    if (id != null && held.get(id) !== projectId) throw notInProject("Track");
  }
}

/**
 * Creates a session. A body that leaves `main` out gets the project's
 * default: where that makes a new linked session the main, the track's
 * previous main steps down in the same transaction. A body that names
 * `main: true` for a track that already has one is a 409.
 */
export async function createSession(
  session: WithSamples<DefaultableLevel<NewSession>>
): Promise<Session> {
  const { samples, ...named } = session;
  return db.transaction(async (tx) => {
    await lockTracksIn(tx, [named.trackId], named.projectId);
    const takesMain = await takesMainByDefault(tx, named);
    if (takesMain) await clearTrackMain(tx, named.trackId!);

    const [result] = await tx
      .insert(sessions)
      .values(
        await withDefaultLevel(takesMain ? { ...named, main: true } : named, tx)
      )
      .onConflictDoNothing()
      .returning();

    // The insert yields nothing only when it collides with `dedupe_filepaths`
    // or `one_main` — the project already holds that file, or the track
    // already has a main.
    if (!result)
      throw new HTTPException(409, {
        message: "Session conflicts with one this project already holds",
      });

    if (samples)
      await replaceSessionSamples(tx, result.id, result.projectId, samples);

    return result;
  });
}

/** The bare session row, no relations — for diffing before an update. */
export async function getSessionRow(
  sessionId: number
): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row;
}

/**
 * Patches a session. The row update, the sample rows (`samples` replaces them,
 * null empties them, absent leaves them) and the save it records land
 * together or not at all.
 */
export function updateSession(
  sessionId: number,
  session: WithSamples<Partial<NewSession>>
): Promise<Session> {
  return db.transaction((tx) => patchSession(tx, sessionId, session));
}

/** `updateSession`'s writes, inside a transaction the caller owns. */
async function patchSession(
  tx: Tx,
  sessionId: number,
  session: WithSamples<Partial<NewSession>>
): Promise<Session> {
  const { samples, ...columns } = session;
  const trackProjects = await lockTracks(tx, [columns.trackId]);
  // `updatedAt` is named because a patch of only `samples` has no column to
  // set, and drizzle refuses an empty update.
  const [result] = await tx
    .update(sessions)
    .set({ ...columns, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();

  if (!result) throw new HTTPException(404);
  if (
    columns.trackId != null &&
    trackProjects.get(columns.trackId) !== result.projectId
  )
    throw notInProject("Track");

  if (samples !== undefined)
    await replaceSessionSamples(tx, sessionId, result.projectId, samples ?? []);

  if (session.localFileUpdatedAt != null) {
    const paths = await samplePathsOf([sessionId], tx);
    const save = saveFromSession(
      result,
      sourceOfPatch(session),
      paths.get(sessionId) ?? []
    );
    if (save) await recordRevisions([save], tx);
  }

  return result;
}

/** Each session's sample paths in position order; a session with none is absent. */
async function samplePathsOf(
  sessionIds: number[],
  executor?: Parameters<typeof samplesForSessions>[1]
): Promise<Map<number, string[]>> {
  const samples = await samplesForSessions(sessionIds, executor);
  return new Map(
    [...samples].map(([id, list]) => [id, list.map((sample) => sample.path)])
  );
}

/**
 * A session's own machine-written columns — refreshed by every scan whether
 * or not anything a person cares about changed — kept out of its activity
 * diffs. The entity module's `activityIgnoredFields` is this same constant,
 * so the generic routes and this file's own bulk writes agree on it.
 */
export const SESSION_ACTIVITY_IGNORED_FIELDS = [
  "fingerprint",
  "localFileUpdatedAt",
] as const;

const getSessionSchema = sessionSchema.extend({
  priority: priorityLevelSchema,
  /** Null until the session is assigned to a track. */
  track: trackSchema
    .extend({
      collections: z.array(collectionSchema),
    })
    .nullable(),
  attachments: z.array(attachedAssetSchema),
  comments: z.array(commentSchema),
  labels: z.array(labelSchema),
});

/**
 * A session as the unpaginated project listing returns it: the parent track as
 * a plain row (null while the session is unassigned), its attachments and its
 * comments. Labels are not joined — the listing does not read them.
 */
export const projectSessionSchema = sessionSchema.extend({
  track: trackSchema.nullable(),
  attachments: z.array(assetSchema),
  comments: z.array(commentSchema),
});

export type ProjectSession = z.infer<typeof projectSessionSchema>;

/**
 * The parent track as a listed session names it: the track column links the
 * title, and the collection column links each release the track belongs to.
 * Null for a session that has not been assigned to a track yet.
 */
const listSessionTrackSchema = trackSchema
  .pick({ id: true, title: true })
  .extend({
    collections: z.array(collectionSchema.pick({ id: true, title: true })),
  });

/**
 * A session as a listing returns it. The notes document, the sample paths, the
 * set's structure and the attachment and comment rows are the session page's;
 * a listing renders the DAW metadata and the file columns only.
 */
export const listSessionSchema = sessionSchema
  .omit({
    notes: true,
    notesText: true,
    structure: true,
  })
  .extend({
    priority: priorityLevelSchema,
    track: listSessionTrackSchema.nullable(),
    labels: z.array(labelSchema),
    /** Whether the session's track is archived; see `sessionArchived`. */
    archived: z.boolean(),
    /** The session's newest save, or null when it has none. */
    lastSaveAt: z.date().nullable(),
    /** How many saves the session has recorded. */
    saveCount: z.number(),
    /** Whether the session's set is in a dit repo: a repo holds it. */
    inDit: z.boolean(),
  });

export type ListSession = z.infer<typeof listSessionSchema>;

/** A session with everything its page reads. */
export const sessionDetailSchema = withArtwork(getSessionSchema).extend({
  /** The folder name of the repo holding the session's set; null for a session in no repo. */
  repoName: z.string().nullable(),
  /** The machine with this session open, while it is online and its owner is still in the project. */
  openOn: openOnSchema,
  /**
   * The samples the session file references, in the file's order, each with
   * whether the hub holds its bytes.
   */
  samples: z.array(
    sessionSampleSchema.extend({
      held: z.boolean(),
      /** The object id `GET /samples/:hash` serves it by, when held. */
      object: z.string().nullable(),
    })
  ),
  /** How many saves the session has recorded, independent of `saves`' page size. */
  saveCount: z.number(),
  /** The whole dit history in counts, independent of how much of it the page loaded. */
  history: sessionHistorySchema,
  /** True when the session's track is archived; false for a session with no track. */
  archived: z.boolean(),
});

export type SessionDetail = z.infer<typeof sessionDetailSchema>;

/** The session's samples, each marked with whether its repo holds the bytes. */
async function samplesWithHeld(sessionId: number, repoId: number | null) {
  const samples = (await samplesForSessions([sessionId])).get(sessionId) ?? [];
  if (samples.length === 0) return [];
  const held = await heldSampleObjects(sessionId, repoId);
  return samples.map((sample) => ({
    ...sample,
    held: held.has(sample.path),
    object: held.get(sample.path) ?? null,
  }));
}

export async function getSession(sessionId: number): Promise<SessionDetail> {
  const result = await db.query.sessions.findFirst({
    with: {
      priority: { columns: priorityLevelColumns },
      track: { with: { collections: true } },
      repo: { columns: { name: true } },
      attachments: attachmentsWithUploadedBy,
      comments: true,
    },
    where: {
      id: sessionId,
    },
  });

  if (!result) throw new HTTPException(404);

  const [saveCountRow] = await db
    .select({ saveCount: count() })
    .from(saves)
    .where(eq(saves.sessionId, sessionId));

  const { repo, ...session } = result;
  return {
    ...session,
    repoName: repo?.name ?? null,
    openOn: await openOnFor(sessionId),
    labels: await getEntityLabels("session", sessionId),
    artwork: await artworkForSession(result),
    samples: await samplesWithHeld(sessionId, result.repoId),
    saveCount: saveCountRow?.saveCount ?? 0,
    history: await getSessionHistory(sessionId),
    archived: result.track?.archivedAt != null,
  };
}

export async function bulkAttachToSessions(
  pairs: { sessionId: number; assetId: number }[]
): Promise<{ attached: number; skipped: number }> {
  const result = await db
    .insert(sessionAttachments)
    .values(pairs)
    .onConflictDoNothing()
    .returning();

  return {
    attached: result.length,
    skipped: pairs.length - result.length,
  };
}

/** One re-link: the session, the track it now belongs to (none for unlinked), and whether it is that track's main. */
const sessionMoveSchema = z.object({
  sessionId: z.number(),
  trackId: z.number().nullable(),
  main: z.boolean(),
});

export type SessionMove = z.infer<typeof sessionMoveSchema>;

/** Body of the MCP `link_sessions` tool. */
export const sessionMovesSchema = z.object({
  moves: z.array(sessionMoveSchema),
});

/**
 * Bulk re-links sessions to tracks. Every session it re-links, and every track
 * it links one to, must sit in `projectId`; else 404. Both are checked under
 * lock, the tracks before the sessions, so a move of either that races the
 * re-link either committed first and is refused here, or waits for it.
 *
 * `sessions.one_main` is a partial unique index (one `main = true` per track),
 * so for every destination track that will gain a main, that track's existing
 * main is cleared first.
 */
export async function bulkMoveSessions(
  moves: SessionMove[],
  projectId: number,
  actorId: string
): Promise<void> {
  if (moves.length === 0) return;

  const sessionIds = [...new Set(moves.map((m) => m.sessionId))];
  const mainDestinations = [
    ...new Set(
      moves.flatMap((m) => (m.main && m.trackId != null ? [m.trackId] : []))
    ),
  ];

  const before = await db.transaction(async (tx) => {
    await lockTracksIn(
      tx,
      moves.map((move) => move.trackId),
      projectId
    );
    const locked = await tx
      .select({
        id: sessions.id,
        trackId: sessions.trackId,
        main: sessions.main,
      })
      .from(sessions)
      .where(
        and(inArray(sessions.id, sessionIds), eq(sessions.projectId, projectId))
      )
      .orderBy(sessions.id)
      .for("update");
    if (locked.length !== sessionIds.length) throw notInProject("Session");

    if (mainDestinations.length > 0)
      await tx
        .update(sessions)
        .set({ main: false })
        .where(
          and(
            eq(sessions.main, true),
            inArray(sessions.trackId, mainDestinations)
          )
        );

    // One statement for the whole batch: raw SQL bypasses the `$onUpdate` hook
    // that a drizzle `update` would run, so `updated_at` is set here.
    await tx.execute(sql`
      update ${sessions} as s
      set track_id = v.track_id, main = v.main, updated_at = now()
      from (values ${sql.join(
        moves.map(
          (m) =>
            sql`(${m.sessionId}::int, ${m.trackId}::int, ${m.main}::boolean)`
        ),
        sql`, `
      )}) as v(session_id, track_id, main)
      where s.id = v.session_id
    `);
    return locked;
  });
  const beforeById = new Map(before.map((row) => [row.id, row]));

  await recordActivityDiffs(
    moves.flatMap((move) => {
      const prior = beforeById.get(move.sessionId);
      if (!prior) return [];
      return [
        {
          projectId,
          entityType: "session" as const,
          entityId: move.sessionId,
          userId: actorId,
          before: { trackId: prior.trackId, main: prior.main },
          after: { trackId: move.trackId, main: move.main },
        },
      ];
    })
  );
}

/**
 * Deletes a session. Attachment joins cascade (session_attachments
 * onDelete: cascade); track links and primary-attachment references are
 * cleared first so no FK orphans remain.
 */
export async function deleteSession(sessionId: number): Promise<Session> {
  return db.transaction(async (tx) => {
    await clearEntityLabels(tx, "session", sessionId);
    const [deleted] = await tx
      .delete(sessions)
      .where(eq(sessions.id, sessionId))
      .returning();
    if (!deleted) throw new HTTPException(404);
    return deleted;
  });
}

/** Every session in a project, hydrated the way the unpaginated list shows it. */
export async function getSessionsInProject(
  projectId: number
): Promise<ProjectSession[]> {
  return db.query.sessions.findMany({
    with: {
      track: true,
      attachments: true,
      comments: true,
    },
    where: {
      projectId: projectId,
    },
  });
}

/*
 * The project-scoped session listing: sort keys, groupings, filters, the
 * paginated page, the bulk writes and the summary list.
 */

/** Whether a session's set is in a dit repo: a repo holds it. */
const inDitSql = sql<boolean>`${sessions.repoId} is not null`;

/** The `inDit` filter's predicate; absent is no filter. */
function inDitFilterSql(inDit: boolean | undefined): SQL | undefined {
  return inDit == null
    ? undefined
    : inDit
      ? isNotNull(sessions.repoId)
      : isNull(sessions.repoId);
}

export const sessionSortColumns = {
  id: sessions.id,
  name: sessions.name,
  daw: sessions.daw,
  priority: priorityLevels.rank,
  tempo: sessions.tempo,
  main: sessions.main,
  track: tracks.title,
  key: sql`nullif(trim(concat_ws(' ', ${sessions.rootNote}, ${sessions.scale})), '')`,
  tracks: sessions.tracksCount,
  scenes: sessions.scenesCount,
  machine: sessions.localFileMachineName,
  LocalFileUpdatedAt: sessions.localFileUpdatedAt,
  localFileCreatedAt: sessions.localFileCreatedAt,
  createdAt: sessions.createdAt,
  updatedAt: sessions.updatedAt,
  lastSaveAt: sql`(select max(${saves.fileUpdatedAt}) from ${saves} where ${saves.sessionId} = ${sessions.id})`,
  saveCount: sql`(select count(*) from ${saves} where ${saves.sessionId} = ${sessions.id})`,
  inDit: inDitSql,
} as const;

const trackJoin: TableJoin = {
  table: tracks,
  on: eq(sessions.trackId, tracks.id),
};

const priorityJoin: TableJoin = {
  table: priorityLevels,
  on: eq(sessions.priorityId, priorityLevels.id),
};

/**
 * The joins a session sort key reads beyond `sessions`, applied by the plain
 * and the grouped page alike. A key absent here needs none.
 */
const sessionSortJoins: Partial<
  Record<keyof typeof sessionSortColumns, readonly TableJoin[]>
> = {
  track: [trackJoin],
  priority: [priorityJoin],
};

const sessionGroupKeys: Record<string, GroupKey> = {
  daw: {
    keyColumn: sessions.daw,
    orderColumn: sessions.daw,
    noneLabel: "No DAW",
  },
  priority: {
    keyColumn: sessions.priorityId,
    orderColumn: priorityLevels.rank,
    labelColumn: priorityLevels.name,
    joins: [priorityJoin],
    noneLabel: "No priority",
  },
  track: {
    keyColumn: sessions.trackId,
    orderColumn: tracks.title,
    labelColumn: tracks.title,
    joins: [trackJoin],
    noneLabel: "No track",
  },
};

/** Every key a session listing groups by. */
export const sessionGroupColumns: readonly string[] =
  Object.keys(sessionGroupKeys);

type SessionFilters = {
  q?: string;
  daw?: string;
  priority?: number[];
  track?: number;
  archived?: ArchivedScope;
  inDit?: boolean;
};

/** Query parameters `GET /projects/:id/sessions/paginated` takes. */
export const sessionQuerySchema = paginationQuerySchema.extend({
  ...sessionFilterSchema.shape,
  archived: archivedScopeSchema.optional(),
});

export type SessionQuery = z.infer<typeof sessionQuerySchema>;

/**
 * The sessions an `archived` scope admits: absent is sessions of live tracks
 * and unlinked ones, `only` is sessions of archived tracks, `include` is all.
 */
function sessionArchivedScope(
  scope: ArchivedScope | undefined
): SQL | undefined {
  if (scope === "include") return undefined;
  return scope === "only" ? sessionArchived : not(sessionArchived);
}

/**
 * The archived scope a sessions query resolves to. A `track` filter names its
 * track outright, so that track's sessions list whether it is archived or not
 * (as an id selection reaches archived rows), unless `archived` says otherwise.
 */
function sessionArchivedOf(
  archived: ArchivedScope | undefined,
  track: number | undefined
): ArchivedScope | undefined {
  return archived ?? (track != null ? "include" : undefined);
}

function sessionsWhere(projectId: number, f: SessionFilters): SQL | undefined {
  return and(
    eq(sessions.projectId, projectId),
    sessionArchivedScope(f.archived),
    f.q ? ilike(sessions.name, `%${escapeLikeTerm(f.q)}%`) : undefined,
    f.daw ? eq(sessions.daw, f.daw) : undefined,
    membershipFilterSql(sessions.priorityId, f.priority),
    f.track != null ? eq(sessions.trackId, f.track) : undefined,
    inDitFilterSql(f.inDit)
  );
}

export async function getSessionsPage(
  projectId: number,
  query: SessionQuery
): Promise<Paginated<ListSession>> {
  const { page, pageSize } = query;
  const sort = parseSort(query.sort, Object.keys(sessionSortColumns));

  const base = and(
    eq(sessions.projectId, projectId),
    sessionArchivedScope(sessionArchivedOf(query.archived, query.track))
  );
  const qFilter = query.q
    ? ilike(sessions.name, `%${escapeLikeTerm(query.q)}%`)
    : undefined;
  const dawFilter = query.daw ? eq(sessions.daw, query.daw) : undefined;
  const priorityFilter = membershipFilterSql(
    sessions.priorityId,
    query.priority
  );
  const trackFilter =
    query.track != null ? eq(sessions.trackId, query.track) : undefined;
  const inDitFilter = inDitFilterSql(query.inDit);
  const where = and(
    base,
    qFilter,
    dawFilter,
    priorityFilter,
    trackFilter,
    inDitFilter
  );

  const orderKey = sort
    ? sessionSortColumns[sort.key as keyof typeof sessionSortColumns]
    : sessions.updatedAt;
  const group = query.groupBy
    ? (ownGroupKey(sessionGroupKeys, query.groupBy) ?? null)
    : null;
  const sortJoins = sort
    ? (sessionSortJoins[sort.key as keyof typeof sessionSortColumns] ?? [])
    : [];
  const sortSql = [
    sortTerm(orderKey, sort?.desc ?? false),
    sql`${asc(sessions.id)}`,
  ];

  const pageIds = async (): Promise<number[]> => {
    if (group) {
      return groupedIdRows(
        sessions,
        sessions.id,
        group,
        where,
        sortSql,
        sortJoins
      );
    }
    const idRows = await withJoins(
      db.select({ id: sessions.id }).from(sessions).$dynamic(),
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
    db.select({ value: count() }).from(sessions).where(where),
  ]);
  const rowCount = countRows[0]?.value ?? 0;
  // See `listSessionSchema`: the track column links the parent's title and the
  // collection column links each release it belongs to, so the parent track is
  // carried as those names rather than as a whole row.
  const hydrated = await hydratePage(ids, (ids) =>
    db.query.sessions.findMany({
      where: { id: { in: ids } },
      columns: {
        notes: false,
        notesText: false,
        structure: false,
      },
      with: {
        priority: { columns: priorityLevelColumns },
        track: {
          columns: { id: true, title: true },
          with: { collections: { columns: { id: true, title: true } } },
        },
      },
    })
  );
  const hydratedIds = hydrated.map((r) => r.id);
  const [labelsBySession, archivedRows, statsBySession] = await Promise.all([
    getEntityLabelsBatch("session", hydratedIds),
    hydratedIds.length === 0
      ? []
      : db
          .select({ id: sessions.id, archived: sessionArchived })
          .from(sessions)
          .where(inArray(sessions.id, hydratedIds)),
    sessionSaveStats(hydratedIds),
  ]);
  const archivedIds = new Set(
    archivedRows.filter((r) => r.archived).map((r) => r.id)
  );
  const rows = hydrated.map((row) => ({
    ...row,
    labels: labelsBySession.get(row.id) ?? [],
    archived: archivedIds.has(row.id),
    inDit: row.repoId != null,
    lastSaveAt: statsBySession.get(row.id)?.lastSaveAt ?? null,
    saveCount: statsBySession.get(row.id)?.saveCount ?? 0,
  }));

  const [daw, priority, track, inDit] = await Promise.all([
    facetCounts(
      sessions.daw,
      sessions,
      and(base, qFilter, priorityFilter, trackFilter, inDitFilter)
    ),
    facetCounts(
      sessions.priorityId,
      sessions,
      and(base, qFilter, dawFilter, trackFilter, inDitFilter)
    ),
    facetCounts(
      sessions.trackId,
      sessions,
      and(base, qFilter, dawFilter, priorityFilter, inDitFilter)
    ),
    facetCounts(
      inDitSql,
      sessions,
      and(base, qFilter, dawFilter, priorityFilter, trackFilter)
    ),
  ]);

  const facets: Facets = { daw, priority, track, inDit };

  const groups = group ? await groupSummaries(sessions, group, where) : [];

  return { rows, rowCount, page, pageSize, facets, groups };
}

/** A selection's `daw` filter, ignored unless it is a well-formed DAW id. */
function dawFilterValue(raw: string | number | undefined): string | undefined {
  const value = selectionString(raw);
  return value != null && dawIdSchema.safeParse(value).success
    ? value
    : undefined;
}

/** A selection's `inDit` filter, ignored unless it is `true` or `false`. */
function inDitFilterValue(
  raw: string | number | undefined
): boolean | undefined {
  const value = selectionString(raw);
  return value === "true" ? true : value === "false" ? false : undefined;
}

/**
 * A selection's filters. An id list reaches its sessions whatever their
 * track's archive state; `all: true` follows its own `archived` filter, and a
 * malformed one reads as absent.
 */
function sessionSelectionFilters(selection: BulkSelection): SessionFilters {
  const f = selectionFilters(selection);
  const track = selectionNumber(f.track);
  return {
    q: selectionString(f.q),
    daw: dawFilterValue(f.daw),
    inDit: inDitFilterValue(f.inDit),
    priority: selectionIds(f.priority),
    track,
    archived:
      "ids" in selection
        ? "include"
        : sessionArchivedOf(
            archivedScopeSchema.safeParse(f.archived).data,
            track
          ),
  };
}

export async function bulkUpdateSessions(
  projectId: number,
  selection: BulkSelection,
  patch: Partial<NewSession>,
  actorId: string
): Promise<{ updated: number }> {
  const where = selectionScope(
    sessions.id,
    selection,
    sessionsWhere(projectId, sessionSelectionFilters(selection))
  );
  const { before, updated } = await db.transaction(async (tx) => {
    await lockTracksIn(tx, [patch.trackId], projectId);
    // Read under lock, after any wait on the track, so the diff holds no other
    // write that landed in the meantime.
    const before = await tx
      .select()
      .from(sessions)
      .where(where)
      .orderBy(sessions.id)
      .for("update");
    const updated = await tx
      .update(sessions)
      .set(patch)
      .where(where)
      .returning();
    return { before, updated };
  });
  const beforeById = new Map(before.map((row) => [row.id, row]));

  await recordActivityDiffs(
    updated.map((after) => ({
      projectId,
      entityType: "session" as const,
      entityId: after.id,
      userId: actorId,
      before: beforeById.get(after.id) ?? after,
      after,
      ignoredFields: SESSION_ACTIVITY_IGNORED_FIELDS,
    }))
  );

  return { updated: updated.length };
}

export async function selectSessionIds(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = selectionScope(
    sessions.id,
    selection,
    sessionsWhere(projectId, sessionSelectionFilters(selection))
  );
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(where)
    .orderBy(asc(sessions.id));
  return rows.map((row) => row.id);
}

export function bulkDeleteSessions(
  projectId: number,
  selection: BulkSelection
): Promise<number[]> {
  const where = selectionScope(
    sessions.id,
    selection,
    sessionsWhere(projectId, sessionSelectionFilters(selection))
  );
  return deleteSelected("session", (tx) =>
    tx.delete(sessions).where(where).returning({ id: sessions.id })
  );
}

export const sessionSummarySchema = sessionSchema
  .pick({
    id: true,
    name: true,
    daw: true,
    trackId: true,
    main: true,
    updatedAt: true,
  })
  .extend({
    /** True when the session's track is archived; false for a session with no track. */
    archived: z.boolean(),
  });

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** Every session in a project as the pickers and "recently edited" lists read it. */
export async function getSessionSummaries(
  projectId: number
): Promise<SessionSummary[]> {
  return db
    .select({
      id: sessions.id,
      name: sessions.name,
      daw: sessions.daw,
      trackId: sessions.trackId,
      main: sessions.main,
      updatedAt: sessions.updatedAt,
      archived: sessionArchived,
    })
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(desc(sessions.updatedAt));
}

/**
 * A session no repo holds as the backfill's matcher reads it: where the file
 * was when last scanned and every fingerprint the session has recorded, the
 * current one and each scan save's, so a set saved since the last scan still
 * matches through an older copy.
 */
export const ditCandidateSchema = sessionSchema
  .pick({
    id: true,
    name: true,
    trackId: true,
    localFilepath: true,
    localFileMachineName: true,
  })
  .extend({
    /** The title of the session's track; null for a session with no track. */
    trackTitle: z.string().nullable(),
    /** Distinct and non-empty, in no order. */
    fingerprints: z.array(z.string()),
    /** The session's newest save, or null when it has none. */
    lastSaveAt: z.date().nullable(),
  });

export type DitCandidate = z.infer<typeof ditCandidateSchema>;

/** The Ableton sessions of a project that no repo holds: what a set on disk can be bound to. */
export async function getDitCandidates(
  projectId: number
): Promise<DitCandidate[]> {
  return db
    .select({
      id: sessions.id,
      name: sessions.name,
      trackId: sessions.trackId,
      trackTitle: tracks.title,
      localFilepath: sessions.localFilepath,
      localFileMachineName: sessions.localFileMachineName,
      fingerprints: sql<string[]>`array(
        select ${saves.fingerprint} from ${saves}
        where ${saves.sessionId} = ${sessions.id}
          and ${saves.source} = 'scan'
          and ${saves.fingerprint} is not null
        union
        select ${sessions.fingerprint} where ${sessions.fingerprint} is not null
      )`,
      lastSaveAt:
        sql<Date | null>`(select max(${saves.fileUpdatedAt}) from ${saves} where ${saves.sessionId} = ${sessions.id})`.mapWith(
          saves.fileUpdatedAt
        ),
    })
    .from(sessions)
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .where(
      and(
        eq(sessions.projectId, projectId),
        eq(sessions.daw, "ableton"),
        isNull(sessions.repoId)
      )
    )
    .orderBy(asc(sessions.id));
}

/** One DAW a project's sessions carry: its module id and, if known, its display name. */
export const sessionDawSchema = z.object({
  daw: z.string(),
  dawName: z.string().nullable(),
});

export type SessionDaw = z.infer<typeof sessionDawSchema>;

/**
 * Every distinct `(daw, dawName)` pair among a project's sessions, for the
 * table's DAW filter and the manual session form's suggestions. Two sessions
 * tagged with the same id but a different name (a scanner upgrade that
 * renamed its module) both appear — the caller reads `dawName` for display
 * and filters by `daw`.
 */
export async function getSessionDaws(projectId: number): Promise<SessionDaw[]> {
  return db
    .selectDistinct({ daw: sessions.daw, dawName: sessions.dawName })
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(asc(sessions.daw));
}

/** One device across a project: how many sessions and tracks carry it, and where it comes from. */
export const pluginUsageSchema = z.object({
  name: z.string(),
  sessions: z.number(),
  tracks: z.number(),
  /** The sessions that carry the device, in id order. */
  sessionIds: z.array(z.number()),
  /** How many track entries carry the device in each session, in `sessionIds`' order. */
  sessionTracks: z.array(z.number()),
  /** `"builtin"` for a DAW's own device; `"plugin"` for a third-party one. */
  origin: z.enum(["builtin", "plugin"]),
  host: pluginHostSchema.optional(),
  manufacturer: z.string().optional(),
});

export type PluginUsage = z.infer<typeof pluginUsageSchema>;

/**
 * Every device named by any session's structure in a project, most widely used
 * first. A DAW's own built-in devices are counted alongside third-party
 * plugins — the client decides whether to show them.
 *
 * `tracks` counts track entries across the whole project, so a device used on
 * four tracks of one session and two of another reads as six, and
 * `sessionTracks` keeps that count per session (`[4, 2]`); `sessions` counts
 * the sessions themselves. Sessions parsed before the structure walk existed
 * carry a null `structure` and contribute nothing.
 *
 * `origin` reads off a session's `structure.plugins` map: present there means
 * a third-party plugin, absent means one of the DAW's own devices. `max()` is
 * a tie-break for a name different sessions recorded differently — it never
 * happens for a real plugin, since its host and manufacturer are fixed by the
 * install, and costs nothing when it doesn't.
 */
export async function getProjectPlugins(
  projectId: number
): Promise<PluginUsage[]> {
  const { rows } = await db.execute<{
    name: string;
    sessions: number | string;
    tracks: number | string;
    session_ids: number[];
    session_tracks: number[];
    host: PluginHost | null;
    manufacturer: string | null;
  }>(sql`
    with uses as (
      select
        d as name,
        s.id as session_id,
        count(*)::int as tracks,
        max(p.value ->> 'host') as host,
        max(p.value ->> 'manufacturer') as manufacturer
      from ${sessions} s
      cross join lateral jsonb_array_elements(s.structure -> 'tracks') t
      cross join lateral jsonb_array_elements_text(t -> 'devices') d
      left join lateral (select s.structure -> 'plugins' -> d as value) p on true
      where s.project_id = ${projectId}
        and jsonb_typeof(s.structure -> 'tracks') = 'array'
      group by d, s.id
    )
    select
      name,
      count(*) as sessions,
      sum(tracks) as tracks,
      array_agg(session_id order by session_id) as session_ids,
      array_agg(tracks order by session_id) as session_tracks,
      max(host) as host,
      max(manufacturer) as manufacturer
    from uses
    group by name
    order by sessions desc, tracks desc, name asc
  `);

  return rows.map((row) => ({
    name: String(row.name),
    sessions: Number(row.sessions),
    tracks: Number(row.tracks),
    sessionIds: row.session_ids,
    sessionTracks: row.session_tracks,
    origin: row.host != null ? ("plugin" as const) : ("builtin" as const),
    host: row.host ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
  }));
}

/** One session that carries a given device, with the tracks that carry it. */
export const pluginSessionSchema = z.object({
  id: z.number(),
  name: z.string(),
  daw: z.string(),
  updatedAt: z.date(),
  trackId: z.number().nullable(),
  trackTitle: z.string().nullable(),
  /** The names of this session's tracks that carry the device, in set order. */
  onTracks: z.array(z.string()),
});

export type PluginSession = z.infer<typeof pluginSessionSchema>;

/**
 * Every session in a project whose structure carries a device, most recently
 * saved first. A device no session carries answers an empty list rather than
 * a 404 — the caller cannot tell a stale name from a fresh one, and both read
 * the same as "nothing there".
 *
 * `jsonb_exists` is the function form of the `?` "does this array contain the
 * text" operator: written as a bare `?` inside a parameterized query, it is
 * ambiguous with the placeholder syntax some Postgres clients pre-parse for,
 * so the function form is used instead of the operator.
 */
export async function getSessionsByDevice(
  projectId: number,
  device: string
): Promise<PluginSession[]> {
  const { rows } = await db.execute<{
    id: number;
    name: string;
    daw: string;
    updated_at_utc: string;
    track_id: number | null;
    track_title: string | null;
    on_tracks: string[];
  }>(sql`
    select s.id, s.name, s.daw,
           to_char(s.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at_utc,
           s.track_id, tr.title as track_title,
           array_agg(t.value ->> 'name' order by t.ordinality) as on_tracks
    from ${sessions} s
    left join ${tracks} tr on tr.id = s.track_id
    cross join lateral jsonb_array_elements(s.structure -> 'tracks')
      with ordinality t(value, ordinality)
    where s.project_id = ${projectId}
      and jsonb_typeof(s.structure -> 'tracks') = 'array'
      and jsonb_exists(t.value -> 'devices', ${device})
    group by s.id, tr.title
    order by s.updated_at desc
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    daw: row.daw,
    // Raw SQL bypasses drizzle's own timestamp mapping, so the column comes
    // back as text: an ISO string spelt in UTC, which parses to the stored
    // instant whatever zone the process runs in.
    updatedAt: new Date(row.updated_at_utc),
    trackId: row.track_id,
    trackTitle: row.track_title,
    onTracks: row.on_tracks,
  }));
}
