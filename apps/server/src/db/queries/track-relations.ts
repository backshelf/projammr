import { and, eq, getTableColumns, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../index.js";
import {
  relationTypeSchema,
  trackRelationTypes,
} from "../schema/track-relation-types.js";
import {
  type NewTrackRelation,
  type TrackRelationRow,
  trackRelations,
  tracks,
  trackSchema,
} from "../schema/tracks.js";
import { recordActivity } from "./activity.js";
import { rethrowRelationTypeGone } from "./track-relation-types.js";

/**
 * Body for `POST /tracks/:id/relations`. The path track is the derivative;
 * the type is one of its project's relation types.
 */
export const addTrackRelationSchema = z.object({
  toTrackId: z.number().int().positive(),
  relationTypeId: z.number().int().positive(),
});

/**
 * One relation as the track detail page and table consume it: the row's type
 * plus the track on the other end. `direction` says how to read it from the
 * perspective of the track that was fetched — `"from"` means this track is
 * the derivative ("remix of otherTrack"), `"to"` means it is the source
 * ("remixed by otherTrack").
 */
export const trackRelationEdgeSchema = z.object({
  id: z.number(),
  relationType: relationTypeSchema,
  direction: z.enum(["from", "to"]),
  otherTrack: trackSchema.pick({ id: true, title: true, artists: true }),
});

export type TrackRelationEdge = z.infer<typeof trackRelationEdgeSchema>;

/** The columns of a type a relation carries. */
const relationTypeColumns = { id: true, name: true } as const;

/**
 * Both sides of a track's relations, flattened into edges. A row where the
 * track is `fromTrackId` becomes a `"from"` edge; a row where it is
 * `toTrackId` becomes a `"to"` edge.
 */
export async function getTrackRelationEdges(
  trackId: number
): Promise<TrackRelationEdge[]> {
  return (await getTrackRelationEdgesBatch([trackId])).get(trackId) ?? [];
}

/**
 * How the from-track's relations read in the activity feed: one line per edge
 * where this track is the derivative, in the order the relations were made.
 */
async function fromRelationLabels(trackId: number): Promise<string[]> {
  const rows = await db
    .select({ type: trackRelationTypes.name, title: tracks.title })
    .from(trackRelations)
    .innerJoin(tracks, eq(tracks.id, trackRelations.toTrackId))
    .innerJoin(
      trackRelationTypes,
      eq(trackRelationTypes.id, trackRelations.relationTypeId)
    )
    .where(eq(trackRelations.fromTrackId, trackId))
    .orderBy(trackRelations.id);
  return rows.map((r) => `${r.type} of ${r.title}`);
}

/** The project a track belongs to, for the activity row its relations log. */
async function trackProjectId(trackId: number): Promise<number | null> {
  const [row] = await db
    .select({ projectId: tracks.projectId })
    .from(tracks)
    .where(eq(tracks.id, trackId));
  return row?.projectId ?? null;
}

/** Logs a from-track's relation list moving from `before` to its current state. */
async function logRelationChange(
  trackId: number,
  before: string[],
  actorId: string
): Promise<void> {
  const projectId = await trackProjectId(trackId);
  await recordActivity({
    projectId,
    entityType: "track",
    entityId: trackId,
    userId: actorId,
    action: "updated",
    before: { relations: before },
    after: { relations: await fromRelationLabels(trackId) },
  });
}

/** One relation row with the type it carries, as the relation writes answer it. */
async function relationRow(
  relationId: number
): Promise<TrackRelationRow | undefined> {
  const [row] = await db
    .select({
      ...getTableColumns(trackRelations),
      relationType: {
        id: trackRelationTypes.id,
        name: trackRelationTypes.name,
      },
    })
    .from(trackRelations)
    .innerJoin(
      trackRelationTypes,
      eq(trackRelationTypes.id, trackRelations.relationTypeId)
    )
    .where(eq(trackRelations.id, relationId));
  return row;
}

/**
 * Links `fromTrackId` as a derivative of `toTrackId`. Rejects self-relations
 * and duplicates (same pair + relation type). Cycles between two tracks — A a
 * remix of B and B a remix of A — are permitted; they are a valid statement,
 * not a data error. The caller has checked the other track and the type
 * belong to the from-track's project.
 */
export async function addTrackRelation(
  relation: NewTrackRelation,
  actorId: string
): Promise<TrackRelationRow> {
  if (relation.fromTrackId === relation.toTrackId) {
    throw new HTTPException(400, {
      message: "A track cannot be related to itself",
    });
  }

  const before = await fromRelationLabels(relation.fromTrackId);

  // Letting the unique constraint decide keeps this one statement and closes
  // the window where two identical requests both pass a prior existence check
  // and the loser fails on the insert.
  const [row] = await db
    .insert(trackRelations)
    .values(relation)
    .onConflictDoNothing()
    .returning({ id: trackRelations.id })
    .catch(rethrowRelationTypeGone);
  if (!row) {
    throw new HTTPException(409, { message: "That relation already exists" });
  }

  await logRelationChange(relation.fromTrackId, before, actorId);
  return (await relationRow(row.id))!;
}

/** Removes a relation by its id, scoped to a track it touches on either end. */
export async function deleteTrackRelation(
  trackId: number,
  relationId: number,
  actorId: string
): Promise<TrackRelationRow> {
  const existing = await relationRow(relationId);
  if (
    !existing ||
    (existing.fromTrackId !== trackId && existing.toTrackId !== trackId)
  ) {
    throw new HTTPException(404);
  }

  const before = await fromRelationLabels(existing.fromTrackId);

  const [row] = await db
    .delete(trackRelations)
    .where(
      and(
        eq(trackRelations.id, relationId),
        or(
          eq(trackRelations.fromTrackId, trackId),
          eq(trackRelations.toTrackId, trackId)
        )
      )
    )
    .returning({ id: trackRelations.id });
  if (!row) throw new HTTPException(404);

  await logRelationChange(existing.fromTrackId, before, actorId);
  return existing;
}

/**
 * `getTrackRelationEdges` for many tracks in two queries rather than two per
 * track. Tracks with no relations are absent from the map.
 */
export async function getTrackRelationEdgesBatch(
  trackIds: number[]
): Promise<Map<number, TrackRelationEdge[]>> {
  const out = new Map<number, TrackRelationEdge[]>();
  if (trackIds.length === 0) return out;

  const [from, to] = await Promise.all([
    db.query.trackRelations.findMany({
      where: { fromTrackId: { in: trackIds } },
      with: {
        toTrack: true,
        relationType: { columns: relationTypeColumns },
      },
    }),
    db.query.trackRelations.findMany({
      where: { toTrackId: { in: trackIds } },
      with: {
        fromTrack: true,
        relationType: { columns: relationTypeColumns },
      },
    }),
  ]);

  const push = (trackId: number, edge: TrackRelationEdge) => {
    const list = out.get(trackId) ?? [];
    list.push(edge);
    out.set(trackId, list);
  };

  for (const r of from) {
    push(r.fromTrackId, {
      id: r.id,
      relationType: r.relationType,
      direction: "from",
      otherTrack: {
        id: r.toTrack!.id,
        title: r.toTrack!.title,
        artists: r.toTrack!.artists,
      },
    });
  }
  for (const r of to) {
    push(r.toTrackId, {
      id: r.id,
      relationType: r.relationType,
      direction: "to",
      otherTrack: {
        id: r.fromTrack!.id,
        title: r.fromTrack!.title,
        artists: r.fromTrack!.artists,
      },
    });
  }

  return out;
}
