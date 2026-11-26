import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../index.js";
import { collectionTracks } from "../schema/collections.js";
import type { SaveSource } from "../schema/enums.js";
import { entityLabels } from "../schema/labels.js";
import { members } from "../schema/projects.js";
import { saveMetaSchema, saveSchema } from "../schema/save-schemas.js";
import {
  type NewSave,
  type SaveMeta,
  type Save,
  saves,
} from "../schema/saves.js";
import {
  type NewSession,
  type Session,
  sessions,
  type WithSamples,
} from "../schema/sessions.js";
import { tracks } from "../schema/tracks.js";
import { withCurrentMachineNames } from "./machines.js";

/** The DAW-derived fields a session row carries, picked for a save's `meta`. */
export const saveMetaFields = [
  "tempo",
  "timeSignature",
  "rootNote",
  "scale",
  "tracksCount",
  "scenesCount",
  "dawVersion",
  "structure",
] as const satisfies readonly (keyof Session)[];

/**
 * A patch carrying any of these was written by something that read the file
 * itself; an in-app edit knows none of them. The sample list is one of them,
 * though it is stored beside the row rather than on it.
 */
const scannedFields = ["fingerprint", ...saveMetaFields, "samples"] as const;

/**
 * Inserts one save row per input, ignoring rows that collide with the
 * `(session_id, file_updated_at)` unique index — a repeat save of the same
 * file mtime records no new history. Returns the count actually stored.
 * `executor` is the transaction the rows join, when the caller has one.
 */
export async function recordRevisions(
  rows: NewSave[],
  executor: Pick<typeof db, "insert"> = db
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await executor
    .insert(saves)
    .values(rows)
    .onConflictDoNothing()
    .returning();

  return result.length;
}

/** Who wrote a session patch, judged on the fields only a file read supplies. */
export const sourceOfPatch = (
  patch: WithSamples<Partial<NewSession>>
): SaveSource =>
  scannedFields.some((field) => field in patch) ? "scan" : "app";

/**
 * Builds the save row for a session's current state, or `null` when the
 * session has no local file — hand-created sessions have nothing to log.
 * `samplePaths` are the session's sample rows' paths, in position order.
 */
export function saveFromSession(
  session: Session,
  source: SaveSource,
  samplePaths: string[]
): NewSave | null {
  if (session.localFileUpdatedAt == null) return null;

  const meta = {
    ...Object.fromEntries(
      saveMetaFields.map((field) => [field, session[field]])
    ),
    samplePaths,
  } as SaveMeta;

  return {
    sessionId: session.id,
    projectId: session.projectId,
    fileUpdatedAt: session.localFileUpdatedAt,
    fingerprint: session.fingerprint,
    machineName: session.localFileMachineName,
    source,
    meta,
  };
}

/** A session's save history, newest first. */
export async function getSessionSaves(sessionId: number, limit: number) {
  const rows = await db
    .select()
    .from(saves)
    .where(eq(saves.sessionId, sessionId))
    .orderBy(desc(saves.fileUpdatedAt))
    .limit(limit);
  return withCurrentMachineNames(rows);
}

/** One local day's worth of save activity, bucketed in the caller's zone. */
export const heatmapDaySchema = z.object({
  day: z.string(),
  saves: z.number(),
  sessions: z.number(),
});

/** Across several projects, a day also says how many of them were worked on. */
export const userHeatmapDaySchema = heatmapDaySchema.extend({
  projects: z.number(),
});

export type HeatmapDay = z.infer<typeof heatmapDaySchema>;
export type UserHeatmapDay = z.infer<typeof userHeatmapDaySchema>;

/**
 * A project heatmap can be narrowed to a slice of its sessions. Every filter
 * is optional and they combine, so `{ collectionId, daw }` counts only saves
 * to that DAW's sessions on tracks in that collection.
 */
type HeatmapFilters = {
  trackId?: number;
  collectionId?: number;
  labelId?: number;
  daw?: string;
};

export type ProjectHeatmapScope = {
  kind: "project";
  projectId: number;
} & HeatmapFilters;
export type UserHeatmapScope = { kind: "user"; userId: string };

/** What a heatmap query is scoped to: one project, or every project a user is a member of. */
export type HeatmapScope = ProjectHeatmapScope | UserHeatmapScope;

export type HeatmapRange = { from: Date; to: Date; tz: string };

/**
 * The `where` terms a set of filters contributes, in the order they narrow
 * most cheaply. The collection and label terms are subqueries rather than
 * joins on purpose: joining would multiply a session's save rows by its
 * matching link rows, and the day counts are `count()` over exactly those
 * rows.
 */
function filterPredicates(filters: HeatmapFilters): (SQL | undefined)[] {
  return [
    filters.trackId == null ? undefined : eq(sessions.trackId, filters.trackId),
    filters.daw == null ? undefined : eq(sessions.daw, filters.daw),
    filters.collectionId == null
      ? undefined
      : inArray(
          sessions.trackId,
          db
            .select({ trackId: collectionTracks.trackId })
            .from(collectionTracks)
            .where(eq(collectionTracks.collectionId, filters.collectionId))
        ),
    filters.labelId == null
      ? undefined
      : inArray(
          sessions.id,
          db
            .select({ entityId: entityLabels.entityId })
            .from(entityLabels)
            .where(
              and(
                eq(entityLabels.entityType, "session"),
                eq(entityLabels.labelId, filters.labelId)
              )
            )
        ),
  ];
}

/**
 * Save counts grouped by local calendar day. `tz` is interpolated as a
 * bound parameter (validated by the caller against
 * `Intl.supportedValuesOf("timeZone")` — an unknown zone makes Postgres throw,
 * not answer an empty page). The `projects` column is only meaningful, and
 * only computed, for a user-wide scope: a single project's heatmap has
 * exactly one project by construction.
 */
export function getSaveHeatmap(
  scope: ProjectHeatmapScope,
  range: HeatmapRange
): Promise<HeatmapDay[]>;
export function getSaveHeatmap(
  scope: UserHeatmapScope,
  range: HeatmapRange
): Promise<UserHeatmapDay[]>;
export async function getSaveHeatmap(
  scope: HeatmapScope,
  range: HeatmapRange
): Promise<(HeatmapDay | UserHeatmapDay)[]> {
  const day =
    sql<string>`to_char((${saves.fileUpdatedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${range.tz}, 'YYYY-MM-DD')`.as(
      "day"
    );
  const timeBounds = and(
    gte(saves.fileUpdatedAt, range.from),
    lt(saves.fileUpdatedAt, range.to)
  );

  const base = db
    .select({
      day,
      saves: count(),
      sessions: countDistinct(saves.sessionId),
      ...(scope.kind === "user"
        ? { projects: countDistinct(saves.projectId) }
        : {}),
    })
    .from(saves)
    .innerJoin(sessions, eq(sessions.id, saves.sessionId))
    .$dynamic();

  const scoped =
    scope.kind === "project"
      ? base.where(
          and(
            eq(saves.projectId, scope.projectId),
            timeBounds,
            ...filterPredicates(scope)
          )
        )
      : base
          .innerJoin(members, eq(members.projectId, saves.projectId))
          .where(and(eq(members.userId, scope.userId), timeBounds));

  // Grouping/ordering by the expression again would bind `tz` as a second
  // parameter with a different placeholder number, which Postgres then
  // refuses to recognise as the same expression the SELECT list computed —
  // the output column's alias is what ties them together instead.
  const rows = await scoped.groupBy(sql`day`).orderBy(sql`day`);
  return rows as (HeatmapDay | UserHeatmapDay)[];
}

/**
 * A save as a project's feed reports it: the save itself, the session it
 * belongs to, and the save before it on that same session — flattened onto
 * one object so a client can word the change (`diffSaves(previousMeta,
 * meta)`) without a second round trip.
 */
export type ProjectSave = Save & {
  session: {
    id: number;
    name: string;
    trackId: number | null;
    trackTitle: string | null;
  };
  /** The save before this one on the same session; `null` for the first save seen. */
  previousMeta: SaveMeta | null;
};

export const projectSaveSchema = saveSchema.extend({
  session: z.object({
    id: z.number(),
    name: z.string(),
    trackId: z.number().nullable(),
    trackTitle: z.string().nullable(),
  }),
  previousMeta: saveMetaSchema.nullable(),
});

export type ProjectSavesOptions = HeatmapFilters & {
  limit: number;
  /** A local calendar day (`YYYY-MM-DD`, already validated against `tz`). */
  day?: string;
  tz: string;
  /** Only saves made at or after this instant. */
  since?: Date;
  /** Leaves out saves of sessions on an archived track; track-less sessions stay. */
  liveTracksOnly?: boolean;
};

/**
 * A project's saves, newest first. `day`, when given, narrows to one local
 * calendar day in `tz`; without it, the answer is simply the most recent
 * saves. The four filters are the heatmap's own, applied the same way, so a
 * filtered heatmap and its feed always agree on what counts.
 *
 * The previous-save lookup is a correlated subquery rather than a second
 * round trip per row: it runs once per returned row (at most `limit` of
 * them), on the `save_session_time` index, which is cheaper than
 * shipping every session's whole history to compute it client-side.
 */
export async function getProjectSaves(
  projectId: number,
  options: ProjectSavesOptions
): Promise<{ saves: ProjectSave[]; total: number }> {
  const {
    limit,
    day: dayFilter,
    tz,
    since,
    liveTracksOnly,
    ...filters
  } = options;

  const previous = alias(saves, "previous");
  const previousMeta = db
    .select({ meta: previous.meta })
    .from(previous)
    .where(
      and(
        eq(previous.sessionId, saves.sessionId),
        lt(previous.fileUpdatedAt, saves.fileUpdatedAt)
      )
    )
    .orderBy(desc(previous.fileUpdatedAt))
    .limit(1);

  const day = sql<string>`to_char((${saves.fileUpdatedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      save: saves,
      session: {
        id: sessions.id,
        name: sessions.name,
        trackId: sessions.trackId,
        trackTitle: tracks.title,
      },
      previousMeta: sql<SaveMeta | null>`(${previousMeta})`,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(saves)
    .innerJoin(sessions, eq(sessions.id, saves.sessionId))
    .leftJoin(tracks, eq(tracks.id, sessions.trackId))
    .where(
      and(
        eq(saves.projectId, projectId),
        dayFilter == null ? undefined : eq(day, dayFilter),
        since == null ? undefined : gte(saves.fileUpdatedAt, since),
        liveTracksOnly
          ? or(isNull(sessions.trackId), isNull(tracks.archivedAt))
          : undefined,
        ...filterPredicates(filters)
      )
    )
    .orderBy(desc(saves.fileUpdatedAt))
    .limit(limit);

  const named = await withCurrentMachineNames(rows.map(({ save }) => save));
  return {
    saves: rows.map(({ session, previousMeta }, index) => ({
      ...named[index]!,
      session,
      previousMeta,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * Each session's newest save (`file_updated_at`) and its number of saves, in
 * one grouped query for a page of sessions. A session with no saves has no
 * entry.
 */
export async function sessionSaveStats(
  sessionIds: number[]
): Promise<Map<number, { lastSaveAt: Date; saveCount: number }>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({
      sessionId: saves.sessionId,
      lastSaveAt: max(saves.fileUpdatedAt),
      saveCount: count(),
    })
    .from(saves)
    .where(inArray(saves.sessionId, sessionIds))
    .groupBy(saves.sessionId);
  return new Map(
    rows.flatMap(({ sessionId, lastSaveAt, saveCount }) =>
      lastSaveAt ? [[sessionId, { lastSaveAt, saveCount }] as const] : []
    )
  );
}

/** A track's saves across all its sessions: the newest, and how many. */
export type TrackSaveStats = { lastSaveAt: Date | null; saveCount: number };

/**
 * The save stats of each given track, in one grouped query. A track with no
 * sessions or no saves has no entry; callers read it as `{ null, 0 }`.
 */
export async function trackSaveStats(
  trackIds: number[]
): Promise<Map<number, TrackSaveStats>> {
  if (trackIds.length === 0) return new Map();

  const rows = await db
    .select({
      trackId: sessions.trackId,
      lastSaveAt: max(saves.fileUpdatedAt),
      saveCount: count(),
    })
    .from(saves)
    .innerJoin(sessions, eq(sessions.id, saves.sessionId))
    .where(inArray(sessions.trackId, trackIds))
    .groupBy(sessions.trackId);

  const stats = new Map<number, TrackSaveStats>();
  for (const r of rows) {
    if (r.trackId == null) continue;
    stats.set(r.trackId, { lastSaveAt: r.lastSaveAt, saveCount: r.saveCount });
  }
  return stats;
}
