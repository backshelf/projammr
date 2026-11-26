import { and, asc, count, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ApiError } from "../../lib/http.js";
import { db, type Tx } from "../index.js";
import {
  type RankedRelationType,
  rankedRelationTypeSchema,
  type TrackRelationType,
  trackRelationTypes,
} from "../schema/track-relation-types.js";
import { trackRelations } from "../schema/tracks.js";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../unique-violation.js";
import { recordActivity } from "./activity.js";
import { assertInProject, notInProject } from "./authorization.js";

type Executor = typeof db | Tx;

/**
 * The types every project starts with, in order: the eight kinds of relation
 * a track could always be, each named the way it completes "this track is a
 * … of".
 */
export const DEFAULT_RELATION_TYPES = [
  "remix",
  "remaster",
  "rework",
  "edit",
  "live version",
  "cover",
  "instrumental",
  "acoustic",
] as const;

/** Gives a new project its starting types, inside the transaction creating it. */
export async function seedRelationTypes(
  exec: Executor,
  projectId: number
): Promise<void> {
  await exec
    .insert(trackRelationTypes)
    .values(
      DEFAULT_RELATION_TYPES.map((name, rank) => ({ projectId, name, rank }))
    );
}

/**
 * Every type id a write names must be one of `projectId`'s own types. A type
 * from another project is a 400, not the 404 other foreign ids get: a
 * relation naming one is a malformed request for that project's list rather
 * than a lookup of something the caller may not see.
 */
export function assertRelationTypesInProject(
  ids: readonly (number | null | undefined)[],
  projectId: number
): Promise<void> {
  return assertInProject(
    trackRelationTypes,
    ids,
    projectId,
    RELATION_TYPE,
    400
  );
}

const RELATION_TYPE = "Relation type";
const RELATION_TYPE_FK =
  "track_relations_relation_type_id_track_relation_types_id_fkey";

/**
 * Turns a failed relation write into the answer {@link assertRelationTypesInProject}
 * gives when the write's type was deleted after that check passed, and rethrows
 * any other error, a violation of another key included.
 */
export function rethrowRelationTypeGone(error: unknown): never {
  if (isForeignKeyViolation(error, RELATION_TYPE_FK)) {
    throw notInProject(RELATION_TYPE, 400);
  }
  throw error;
}

/** A project's type by its exact name, for a caller that names types. */
export async function relationTypeByName(
  projectId: number,
  name: string
): Promise<TrackRelationType | undefined> {
  const [row] = await db
    .select()
    .from(trackRelationTypes)
    .where(
      and(
        eq(trackRelationTypes.projectId, projectId),
        eq(trackRelationTypes.name, name)
      )
    );
  return row;
}

/**
 * Adds a type named `name` after the last of `projectId`'s types, reading the
 * last rank inside the insert itself. Answers nothing when the project already
 * has a type of that name.
 */
async function appendRelationType(
  exec: Executor,
  projectId: number,
  name: string
): Promise<TrackRelationType | undefined> {
  const [row] = await exec
    .insert(trackRelationTypes)
    .values({
      projectId,
      name,
      rank: sql`(select coalesce(max(${trackRelationTypes.rank}), -1) + 1 from ${trackRelationTypes} where ${trackRelationTypes.projectId} = ${projectId})`,
    })
    .onConflictDoNothing({
      target: [trackRelationTypes.projectId, trackRelationTypes.name],
    })
    .returning();
  return row;
}

/**
 * `projectId`'s type named `name`, added after its last type when it has
 * none. A write that has to carry a relation into a project calls it: a
 * relation cannot be left without a type, and a list has no default.
 */
export async function ensureRelationType(
  exec: Executor,
  projectId: number,
  name: string
): Promise<number> {
  const byName = and(
    eq(trackRelationTypes.projectId, projectId),
    eq(trackRelationTypes.name, name)
  );
  const [existing] = await exec
    .select({ id: trackRelationTypes.id })
    .from(trackRelationTypes)
    .where(byName);
  if (existing) return existing.id;

  const created = await appendRelationType(exec, projectId, name);
  if (created) return created.id;

  // Another write added the name between the read and the insert.
  const [raced] = await exec
    .select({ id: trackRelationTypes.id })
    .from(trackRelationTypes)
    .where(byName);
  return raced!.id;
}

/** A type as the list answers it: with the number of relations using it. */
export const relationTypeEntrySchema = rankedRelationTypeSchema.extend({
  inUse: z.number().int(),
});

export type RelationTypeEntry = z.infer<typeof relationTypeEntrySchema>;

/** Body for adding a type, and for renaming one. */
export const relationTypeNameSchema = z.object({
  name: z.string().trim().min(1),
});

/** Body for reordering the list: every type of the project, once, first first. */
export const relationTypeOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

/** A project's types in list order, each with the relations that use it. */
export async function getRelationTypes(
  projectId: number
): Promise<RelationTypeEntry[]> {
  return db
    .select({
      id: trackRelationTypes.id,
      name: trackRelationTypes.name,
      rank: trackRelationTypes.rank,
      inUse: count(trackRelations.id),
    })
    .from(trackRelationTypes)
    .leftJoin(
      trackRelations,
      eq(trackRelations.relationTypeId, trackRelationTypes.id)
    )
    .where(eq(trackRelationTypes.projectId, projectId))
    .groupBy(trackRelationTypes.id)
    .orderBy(asc(trackRelationTypes.rank), asc(trackRelationTypes.id));
}

const duplicateName = () =>
  new HTTPException(409, {
    message: "A relation type with that name already exists",
  });

const notFound = () =>
  new HTTPException(404, { message: "Relation type not found" });

/**
 * Locks one of the project's types for the rest of the transaction and
 * answers it; a type of another project is not there. A relation insert
 * naming the type waits on the lock, so a delete that finds it unused cannot
 * be overtaken by one.
 */
async function lockType(
  tx: Tx,
  projectId: number,
  typeId: number
): Promise<TrackRelationType> {
  const [row] = await tx
    .select()
    .from(trackRelationTypes)
    .where(
      and(
        eq(trackRelationTypes.id, typeId),
        eq(trackRelationTypes.projectId, projectId)
      )
    )
    .for("update");
  if (!row) throw notFound();
  return row;
}

function toRanked(type: TrackRelationType): RankedRelationType {
  return { id: type.id, name: type.name, rank: type.rank };
}

/** Logs a change to the project's list as a project activity row. */
function logListChange(
  projectId: number,
  actorId: string,
  before: string | null,
  after: string | null
) {
  return recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { relationType: before },
    after: { relationType: after },
  });
}

/** Adds a type at the end of the list; a name the list already has is a 409. */
export async function createRelationType(
  projectId: number,
  data: z.infer<typeof relationTypeNameSchema>,
  actorId: string
): Promise<RankedRelationType> {
  const created = await appendRelationType(db, projectId, data.name);
  if (!created) throw duplicateName();

  await logListChange(projectId, actorId, null, created.name);
  return toRanked(created);
}

/** Renames a type; a name another type of the list has is a 409. */
export async function renameRelationType(
  projectId: number,
  typeId: number,
  data: z.infer<typeof relationTypeNameSchema>,
  actorId: string
): Promise<RankedRelationType> {
  const { before, after } = await db.transaction(async (tx) => {
    const before = await lockType(tx, projectId, typeId);
    try {
      const [after] = await tx
        .update(trackRelationTypes)
        .set({ name: data.name })
        .where(eq(trackRelationTypes.id, typeId))
        .returning();
      return { before, after: after! };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }
  });

  await logListChange(projectId, actorId, before.name, after.name);
  return toRanked(after);
}

/**
 * Puts the list in the order `ids` names, first first. `ids` must be every
 * type of the project exactly once. The project's types are locked first, so
 * two reorders of one list queue rather than interleave.
 */
export async function reorderRelationTypes(
  projectId: number,
  ids: number[]
): Promise<RelationTypeEntry[]> {
  await db.transaction(async (tx) => {
    const types = await tx
      .select({ id: trackRelationTypes.id })
      .from(trackRelationTypes)
      .where(eq(trackRelationTypes.projectId, projectId))
      .for("update");
    const named = new Set(ids);
    if (
      named.size !== ids.length ||
      ids.length !== types.length ||
      types.some((type) => !named.has(type.id))
    ) {
      throw new HTTPException(400, {
        message: "Name every relation type of the project exactly once",
      });
    }

    await tx.execute(sql`
      update ${trackRelationTypes}
      set rank = v.rank
      from (values ${sql.join(
        ids.map((id, rank) => sql`(${id}::int, ${rank}::int)`),
        sql`, `
      )}) as v(id, rank)
      where ${trackRelationTypes.projectId} = ${projectId}
        and ${trackRelationTypes.id} = v.id
    `);
  });

  return getRelationTypes(projectId);
}

/**
 * Deletes a type no relation uses. While any does, the delete is refused with
 * a 409 carrying how many (`details.inUse`): a relation cannot be left without
 * a type, and a list has no default to move it to.
 */
export async function deleteRelationType(
  projectId: number,
  typeId: number,
  actorId: string
): Promise<void> {
  const deleted = await db.transaction(async (tx) => {
    const type = await lockType(tx, projectId, typeId);
    const [usage] = await tx
      .select({ n: count() })
      .from(trackRelations)
      .where(eq(trackRelations.relationTypeId, typeId));
    const inUse = usage?.n ?? 0;
    if (inUse > 0) {
      throw new ApiError(409, {
        code: "relation_type_in_use",
        message:
          inUse === 1
            ? "1 relation uses this type"
            : `${inUse} relations use this type`,
        details: { inUse },
      });
    }

    await tx
      .delete(trackRelationTypes)
      .where(eq(trackRelationTypes.id, typeId));
    return type;
  });

  await logListChange(projectId, actorId, deleted.name, null);
}
