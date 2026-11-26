import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, type Tx } from "../index.js";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { colourHexSchema } from "../schema/base.js";
import { rawLabelTargetEnum } from "../schema/enums.js";
import {
  entityLabels,
  type Label,
  labels,
  labelSchema,
  type NewLabel,
} from "../schema/labels.js";
import { recordActivity } from "./activity.js";
import { isUniqueViolation } from "../unique-violation.js";

export type LabelTarget = (typeof rawLabelTargetEnum)[number];

/**
 * Body for the entity label-set routes. `labelIds` reference existing project
 * labels; `names` create (or reuse) a label in the project on the fly.
 */
export const setEntityLabelsSchema = z.object({
  labelIds: z.array(z.number().int().positive()).optional(),
  names: z.array(z.string().trim().min(1)).optional(),
});

/**
 * The `add`/`remove` half of `PATCH /bulk/labels`'s body — the label ids to
 * add or drop, leaving every other label a row carries untouched. The route
 * combines this with `projectId` and `selection`, the shape every other bulk
 * route's body carries (`db/queries/pagination.ts`'s `bulkSelectionSchema`,
 * which this file cannot import without a cycle: it imports
 * `clearEntityLabels` from here).
 */
export const bulkSetEntityLabelsSchema = z.object({
  add: z.array(z.number().int().positive()),
  remove: z.array(z.number().int().positive()),
});

export const newLabelSchema = z.object({
  name: z.string().trim().min(1),
  colourHex: colourHexSchema.optional(),
});

/** Body for renaming and/or recolouring a label; at least one field is required. */
export const updateLabelSchema = newLabelSchema
  .partial()
  .refine(
    (patch) => patch.name !== undefined || patch.colourHex !== undefined,
    {
      message: "Provide a name or a colourHex",
    }
  );

type Db = typeof db;
type Executor = Db | Tx;

/** Ids per chunk for a query binding one parameter per id plus `reserve` more. */
function idChunkSize(reserve: number): number {
  return Math.max(1, bindParamLimit() - reserve);
}

export async function getLabelsInProject(projectId: number): Promise<Label[]> {
  return db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
    .orderBy(labels.name);
}

/** Creates a label; a name the project already has is a 409. */
export async function createLabel(
  projectId: number,
  data: z.infer<typeof newLabelSchema>,
  actorId: string
): Promise<Label> {
  const values: NewLabel = { projectId, name: data.name };
  if (data.colourHex) values.colourHex = data.colourHex;

  const [row] = await db
    .insert(labels)
    .values(values)
    .onConflictDoNothing({ target: [labels.projectId, labels.name] })
    .returning();

  if (!row) {
    throw new HTTPException(409, {
      message: "A label with that name already exists",
    });
  }

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { label: null },
    after: { label: row.name },
  });

  return row;
}

/**
 * Renames and/or recolours a label. Scoped by `(project, id)` like
 * `deleteLabel`; a name another label in the project already holds is a 409.
 */
export async function updateLabel(
  projectId: number,
  labelId: number,
  patch: z.infer<typeof updateLabelSchema>,
  actorId: string
): Promise<Label> {
  const scope = and(eq(labels.projectId, projectId), eq(labels.id, labelId));
  const [before] = await db.select().from(labels).where(scope);
  if (!before) throw new HTTPException(404);

  const values: Partial<NewLabel> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.colourHex !== undefined) values.colourHex = patch.colourHex;

  let row: Label | undefined;
  try {
    [row] = await db.update(labels).set(values).where(scope).returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, {
        message: "A label with that name already exists",
      });
    }
    throw error;
  }
  if (!row) throw new HTTPException(404);

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { label: before.name, colourHex: before.colourHex },
    after: { label: row.name, colourHex: row.colourHex },
  });

  return row;
}

/**
 * Deletes a label from a project. `(project, id)` is the pair the route
 * addresses, so scoping the delete both finds the row and refuses one that
 * belongs to a different project — a label from elsewhere is simply not there.
 */
export async function deleteLabel(
  projectId: number,
  labelId: number,
  actorId: string
): Promise<Label> {
  const [row] = await db
    .delete(labels)
    .where(and(eq(labels.projectId, projectId), eq(labels.id, labelId)))
    .returning();
  if (!row) throw new HTTPException(404);

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { label: row.name },
    after: { label: null },
  });

  return row;
}

function entityLabelRows(
  exec: Executor,
  entityType: LabelTarget,
  entityId: number
): Promise<Label[]> {
  return exec
    .select(getTableColumns(labels))
    .from(entityLabels)
    .innerJoin(labels, eq(entityLabels.labelId, labels.id))
    .where(
      and(
        eq(entityLabels.entityType, entityType),
        eq(entityLabels.entityId, entityId)
      )
    )
    .orderBy(labels.name);
}

export function getEntityLabels(
  entityType: LabelTarget,
  entityId: number
): Promise<Label[]> {
  return entityLabelRows(db, entityType, entityId);
}

/**
 * Drops every label link for one entity, or for a whole list of them in a
 * single statement. `entity_labels` has no FK to the target row (the join is
 * polymorphic), so each entity's delete path calls this to avoid leaving
 * dangling links.
 */
export async function clearEntityLabels(
  exec: Executor,
  entityType: LabelTarget,
  entityId: number | number[]
): Promise<void> {
  const ids = Array.isArray(entityId) ? entityId : [entityId];
  if (ids.length === 0) return;

  for (const batch of chunk(ids, idChunkSize(1))) {
    await exec
      .delete(entityLabels)
      .where(
        and(
          eq(entityLabels.entityType, entityType),
          inArray(entityLabels.entityId, batch)
        )
      );
  }
}

/**
 * The subset of `candidateIds` that belong to `projectId`, for a caller that
 * needs to refuse a label from elsewhere before touching any row. Both the
 * single-entity and bulk label writes check ids against this.
 */
async function labelIdsInProject(
  exec: Executor,
  projectId: number,
  candidateIds: number[]
): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set();

  const rows = await exec
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(eq(labels.projectId, projectId), inArray(labels.id, candidateIds))
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Links a new entity to those of `labelIds` that are still labels of
 * `projectId`, skipping the rest without complaint: a project's default labels
 * are a preference, and one deleted since it was set is simply no longer
 * applied.
 */
export async function linkLabelsInProject(
  exec: Executor,
  projectId: number,
  entityType: LabelTarget,
  entityId: number,
  labelIds: readonly number[]
): Promise<void> {
  const found = await labelIdsInProject(exec, projectId, [...labelIds]);
  if (found.size === 0) return;

  await exec
    .insert(entityLabels)
    .values([...found].map((labelId) => ({ labelId, entityType, entityId })));
}

/**
 * Refuses a label id outside `projectId`: the bulk label route's own check,
 * run before it resolves a selection to ids or opens a transaction.
 */
export async function assertLabelsInProject(
  projectId: number,
  labelIds: number[]
): Promise<void> {
  const found = await labelIdsInProject(db, projectId, labelIds);
  if (found.size !== new Set(labelIds).size) {
    throw new HTTPException(400, {
      message: "Label not found in this project",
    });
  }
}

/**
 * Labels for many entities of one type in a single query, grouped by entity id.
 * Entities with no labels are absent from the map. `exec` lets a caller run it
 * inside its own transaction, for a before/after read around a write.
 */
export async function getEntityLabelsBatch(
  entityType: LabelTarget,
  entityIds: number[],
  exec: Executor = db
): Promise<Map<number, Label[]>> {
  const out = new Map<number, Label[]>();
  if (entityIds.length === 0) return out;

  for (const batch of chunk(entityIds, idChunkSize(1))) {
    const rows = await exec
      .select({ entityId: entityLabels.entityId, ...getTableColumns(labels) })
      .from(entityLabels)
      .innerJoin(labels, eq(entityLabels.labelId, labels.id))
      .where(
        and(
          eq(entityLabels.entityType, entityType),
          inArray(entityLabels.entityId, batch)
        )
      )
      .orderBy(labels.name);

    for (const { entityId, ...label } of rows) {
      const list = out.get(entityId) ?? [];
      list.push(label);
      out.set(entityId, list);
    }
  }
  return out;
}

/**
 * Replaces an entity's full label set. `labelIds` must belong to `projectId` —
 * one from another project 404s, the way every other cross-project id does;
 * `names` are created (or matched) in that project first. Returns the new set.
 */
export async function setEntityLabels(
  projectId: number,
  entityType: LabelTarget,
  entityId: number,
  input: z.infer<typeof setEntityLabelsSchema>,
  actorId: string
): Promise<Label[]> {
  const { before, after } = await db.transaction(async (tx) => {
    const before = await entityLabelRows(tx, entityType, entityId);
    const ids = new Set<number>();

    if (input.labelIds?.length) {
      const found = await labelIdsInProject(tx, projectId, input.labelIds);
      if (found.size !== new Set(input.labelIds).size) {
        throw new HTTPException(404, {
          message: "Label not found in this project",
        });
      }
      for (const id of found) ids.add(id);
    }

    for (const name of input.names ?? []) {
      const [row] = await tx
        .insert(labels)
        .values({ projectId, name })
        .onConflictDoUpdate({
          target: [labels.projectId, labels.name],
          set: { updatedAt: new Date() },
        })
        .returning({ id: labels.id });
      if (row) ids.add(row.id);
    }

    await tx
      .delete(entityLabels)
      .where(
        and(
          eq(entityLabels.entityType, entityType),
          eq(entityLabels.entityId, entityId)
        )
      );

    if (ids.size > 0) {
      await tx
        .insert(entityLabels)
        .values([...ids].map((labelId) => ({ labelId, entityType, entityId })));
    }

    return { before, after: await entityLabelRows(tx, entityType, entityId) };
  });

  await recordActivity({
    projectId,
    entityType,
    entityId,
    userId: actorId,
    action: "updated",
    before: { labels: before.map((l) => l.name) },
    after: { labels: after.map((l) => l.name) },
  });

  return after;
}

/**
 * Adds and removes labels across many entities in one transaction, touching
 * only the ids named — every other label a row carries is left alone. The
 * caller (the `/bulk/labels` route) is expected to have already checked `add`
 * and `remove` against the project with {@link assertLabelsInProject}, the
 * same way it resolves `entityIds` before calling in. Returns the number of
 * entities whose label set actually changed: a row already at the target
 * state (every `add` label present, every `remove` label absent) gets no
 * activity row and does not count.
 */
export async function bulkSetEntityLabels(
  projectId: number,
  entityType: LabelTarget,
  entityIds: number[],
  { add, remove }: { add: number[]; remove: number[] },
  actorId: string
): Promise<number> {
  if (entityIds.length === 0) return 0;

  const { before, after } = await db.transaction(async (tx) => {
    const before = await getEntityLabelsBatch(entityType, entityIds, tx);

    if (add.length > 0) {
      // Each id contributes `add.length` rows at 3 bind params apiece, so
      // the chunk is sized by rows, not by id count.
      const idsPerChunk = Math.max(
        1,
        Math.floor(bindParamLimit() / (add.length * 3))
      );
      for (const batch of chunk(entityIds, idsPerChunk)) {
        await tx
          .insert(entityLabels)
          .values(
            batch.flatMap((entityId) =>
              add.map((labelId) => ({ labelId, entityType, entityId }))
            )
          )
          .onConflictDoNothing();
      }
    }

    if (remove.length > 0) {
      for (const batch of chunk(entityIds, idChunkSize(remove.length + 1))) {
        await tx
          .delete(entityLabels)
          .where(
            and(
              eq(entityLabels.entityType, entityType),
              inArray(entityLabels.entityId, batch),
              inArray(entityLabels.labelId, remove)
            )
          );
      }
    }

    return {
      before,
      after: await getEntityLabelsBatch(entityType, entityIds, tx),
    };
  });

  let updated = 0;
  for (const entityId of entityIds) {
    const beforeNames = (before.get(entityId) ?? []).map((l) => l.name);
    const afterNames = (after.get(entityId) ?? []).map((l) => l.name);
    if (JSON.stringify(beforeNames) === JSON.stringify(afterNames)) continue;

    updated++;
    await recordActivity({
      projectId,
      entityType,
      entityId,
      userId: actorId,
      action: "updated",
      before: { labels: beforeNames },
      after: { labels: afterNames },
    });
  }

  return updated;
}

export { labelSchema };
