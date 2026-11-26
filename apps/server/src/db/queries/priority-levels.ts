import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, type Tx } from "../index.js";
import { colourHexSchema } from "../schema/base.js";
import { collections } from "../schema/collections.js";
import {
  type NewPriorityLevel,
  type PriorityLevel,
  priorityLevels,
  type ScaleLevel,
  scaleLevelSchema,
} from "../schema/priority-levels.js";
import { sessions } from "../schema/sessions.js";
import { tracks } from "../schema/tracks.js";
import { isUniqueViolation } from "../unique-violation.js";
import { recordActivity } from "./activity.js";
import { assertInProject } from "./authorization.js";

type Executor = typeof db | Tx;

/**
 * The scale every project starts with, bottom to top: the five values the
 * priority field has always offered, None the default. A five-step ramp from
 * neutral grey through blue, gold and orange to red, each a distinct colour
 * so urgency reads at a glance and each legible as an 18% chip tint on both
 * the light and the dark theme. `20260927223610_priority-levels-recolour`
 * recolours an existing project's untouched levels to match; a migration
 * cannot import these, so its own literal values must be kept in step.
 */
export const DEFAULT_PRIORITY_LEVELS = [
  { name: "None", colour: "#6C7278", isDefault: true },
  { name: "Low", colour: "#0891C9", isDefault: false },
  { name: "Medium", colour: "#D6B529", isDefault: false },
  { name: "High", colour: "#F06B00", isDefault: false },
  { name: "Urgent", colour: "#D0183A", isDefault: false },
] as const;

/** Gives a new project its starting scale, inside the transaction creating it. */
export async function seedPriorityLevels(
  exec: Executor,
  projectId: number
): Promise<void> {
  await exec.insert(priorityLevels).values(
    DEFAULT_PRIORITY_LEVELS.map((level, rank) => ({
      projectId,
      name: level.name,
      colour: level.colour,
      rank,
      isDefault: level.isDefault,
    }))
  );
}

/** The columns of a level a track, collection or session row carries. */
export const priorityLevelColumns = {
  id: true,
  name: true,
  colour: true,
  rank: true,
} as const;

/**
 * The level a new track, collection or session takes when its write names
 * none: the project's default. Every create path goes through here, so this
 * is the one place a missing level becomes the default. A project always has
 * one; a project without one is a broken invariant, not a caller's mistake.
 */
export async function defaultLevelId(
  projectId: number,
  exec: Executor = db
): Promise<number> {
  const [row] = await exec
    .select({ id: priorityLevels.id })
    .from(priorityLevels)
    .where(
      and(
        eq(priorityLevels.projectId, projectId),
        eq(priorityLevels.isDefault, true)
      )
    );
  if (!row) {
    throw new Error(`project ${projectId} has no default priority level`);
  }
  return row.id;
}

/** An insert whose level may be left out, to take the project's default. */
export type DefaultableLevel<T extends { priorityId: number }> = Omit<
  T,
  "priorityId"
> & { priorityId?: number };

/** `values` with its level filled in from {@link defaultLevelId} when it names none. */
export async function withDefaultLevel<
  T extends { projectId: number; priorityId?: number },
>(values: T, exec: Executor = db): Promise<T & { priorityId: number }> {
  return {
    ...values,
    priorityId:
      values.priorityId ?? (await defaultLevelId(values.projectId, exec)),
  };
}

/**
 * Every level id a write names must be one of `projectId`'s own levels. A
 * level from another project is a 400, not the 404 other foreign ids get: a
 * create or a patch naming one is a malformed request for that project's
 * scale rather than a lookup of something the caller may not see.
 */
export function assertLevelsInProject(
  ids: readonly (number | null | undefined)[],
  projectId: number
): Promise<void> {
  return assertInProject(priorityLevels, ids, projectId, "Priority level", 400);
}

/** A project's level by its exact name, for a caller that names levels. */
export async function levelByName(
  projectId: number,
  name: string
): Promise<PriorityLevel | undefined> {
  const [row] = await db
    .select()
    .from(priorityLevels)
    .where(
      and(
        eq(priorityLevels.projectId, projectId),
        eq(priorityLevels.name, name)
      )
    );
  return row;
}

/** How many tracks, collections and sessions hold a level. */
const levelCountsSchema = z.object({
  tracks: z.number().int(),
  collections: z.number().int(),
  sessions: z.number().int(),
});

/** A level as the scale's listing answers it: with the rows that use it. */
export const scaleEntrySchema = scaleLevelSchema.extend({
  counts: levelCountsSchema,
});

export type ScaleEntry = z.infer<typeof scaleEntrySchema>;

export const newPriorityLevelSchema = z.object({
  name: z.string().trim().min(1),
  colour: colourHexSchema,
});

/**
 * Body for renaming, recolouring or making a level the default; at least one
 * is required. The default only ever moves: making another level the default
 * is how this one stops being it, so `isDefault` takes only `true`.
 */
export const updatePriorityLevelSchema = newPriorityLevelSchema
  .partial()
  .extend({ isDefault: z.literal(true).optional() })
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.colour !== undefined ||
      patch.isDefault !== undefined,
    { message: "Provide a name, a colour or isDefault" }
  );

/** Body for reordering a scale: every level of the project, once, bottom first. */
export const priorityOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

/** Query of the delete route: the level the deleted one's rows move to. */
export const deletePriorityLevelQuerySchema = z.object({
  replaceWith: z.coerce.number().int().positive(),
});

const scaleColumns = {
  id: priorityLevels.id,
  name: priorityLevels.name,
  colour: priorityLevels.colour,
  rank: priorityLevels.rank,
  isDefault: priorityLevels.isDefault,
};

/** The three tables whose rows hold a level. */
const LEVELLED_TABLES = { tracks, collections, sessions } as const;

/** How many rows of one table hold each of a project's levels. */
async function levelUsage(
  table: (typeof LEVELLED_TABLES)[keyof typeof LEVELLED_TABLES],
  projectId: number
): Promise<Map<number, number>> {
  const rows = await db
    .select({ levelId: table.priorityId, n: count() })
    .from(table)
    .where(eq(table.projectId, projectId))
    .groupBy(table.priorityId);
  return new Map(rows.map((row) => [row.levelId, row.n]));
}

/** A project's scale bottom to top, each level with the rows that use it. */
export async function getPriorityLevels(
  projectId: number
): Promise<ScaleEntry[]> {
  const [levels, trackCounts, collectionCounts, sessionCounts] =
    await Promise.all([
      db
        .select(scaleColumns)
        .from(priorityLevels)
        .where(eq(priorityLevels.projectId, projectId))
        .orderBy(asc(priorityLevels.rank)),
      levelUsage(tracks, projectId),
      levelUsage(collections, projectId),
      levelUsage(sessions, projectId),
    ]);
  return levels.map((level) => ({
    ...level,
    counts: {
      tracks: trackCounts.get(level.id) ?? 0,
      collections: collectionCounts.get(level.id) ?? 0,
      sessions: sessionCounts.get(level.id) ?? 0,
    },
  }));
}

/**
 * Locks every level of a project's scale for the rest of the transaction and
 * answers them. Every write to a scale takes it first, so two writes to the
 * same scale queue: the second reads ranks, names and the default as the first
 * left them. A project always has a level, so there is always a row to wait on.
 */
function lockScale(tx: Tx, projectId: number): Promise<PriorityLevel[]> {
  return tx
    .select()
    .from(priorityLevels)
    .where(eq(priorityLevels.projectId, projectId))
    .orderBy(asc(priorityLevels.id))
    .for("update");
}

const duplicateName = () =>
  new HTTPException(409, {
    message: "A priority level with that name already exists",
  });

/** The level `levelId` of this project; a level of another project is not there. */
function levelIn(levels: PriorityLevel[], levelId: number): PriorityLevel {
  const level = levels.find((candidate) => candidate.id === levelId);
  if (!level) {
    throw new HTTPException(404, { message: "Priority level not found" });
  }
  return level;
}

function toScaleLevel(level: PriorityLevel): ScaleLevel {
  return {
    id: level.id,
    name: level.name,
    colour: level.colour,
    rank: level.rank,
    isDefault: level.isDefault,
  };
}

/** Adds a level at the top of the scale; a name the scale already has is a 409. */
export async function createPriorityLevel(
  projectId: number,
  data: z.infer<typeof newPriorityLevelSchema>,
  actorId: string
): Promise<ScaleLevel> {
  const created = await db.transaction(async (tx) => {
    const levels = await lockScale(tx, projectId);
    const values: NewPriorityLevel = {
      projectId,
      name: data.name,
      colour: data.colour,
      rank: Math.max(-1, ...levels.map((level) => level.rank)) + 1,
    };
    const [row] = await tx
      .insert(priorityLevels)
      .values(values)
      .onConflictDoNothing({
        target: [priorityLevels.projectId, priorityLevels.name],
      })
      .returning();
    if (!row) throw duplicateName();
    return row;
  });

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { priority: null },
    after: { priority: created.name },
  });

  return toScaleLevel(created);
}

/**
 * Renames or recolours a level, or makes it the default. The flag moves in
 * the same transaction: the old default is cleared before the new one is set,
 * since the one-default index is not deferrable.
 */
export async function updatePriorityLevel(
  projectId: number,
  levelId: number,
  patch: z.infer<typeof updatePriorityLevelSchema>,
  actorId: string
): Promise<ScaleLevel> {
  const { before, after } = await db.transaction(async (tx) => {
    const before = levelIn(await lockScale(tx, projectId), levelId);

    if (patch.isDefault) {
      await tx
        .update(priorityLevels)
        .set({ isDefault: false })
        .where(
          and(
            eq(priorityLevels.projectId, projectId),
            eq(priorityLevels.isDefault, true),
            ne(priorityLevels.id, levelId)
          )
        );
    }

    const values: Partial<NewPriorityLevel> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.colour !== undefined) values.colour = patch.colour;
    if (patch.isDefault) values.isDefault = true;

    let after: PriorityLevel | undefined;
    try {
      [after] = await tx
        .update(priorityLevels)
        .set(values)
        .where(eq(priorityLevels.id, levelId))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }
    if (!after) throw new HTTPException(404);
    return { before, after };
  });

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: {
      priority: before.name,
      colour: before.colour,
      isDefault: before.isDefault,
    },
    after: {
      priority: after.name,
      colour: after.colour,
      isDefault: after.isDefault,
    },
  });

  return toScaleLevel(after);
}

/**
 * Puts a scale in the order `ids` names, bottom first. `ids` must be every
 * level of the project exactly once. The rank index is not deferrable, so
 * every rank is first moved out of the way (to its level's negated id, which
 * no other level holds) and then the new ranks are written in one statement.
 */
export async function reorderPriorityLevels(
  projectId: number,
  ids: number[]
): Promise<ScaleEntry[]> {
  await db.transaction(async (tx) => {
    const levels = await lockScale(tx, projectId);
    const named = new Set(ids);
    if (
      named.size !== ids.length ||
      ids.length !== levels.length ||
      levels.some((level) => !named.has(level.id))
    ) {
      throw new HTTPException(400, {
        message: "Name every level of the project exactly once",
      });
    }

    await tx
      .update(priorityLevels)
      .set({ rank: sql`-${priorityLevels.id}` })
      .where(eq(priorityLevels.projectId, projectId));
    await tx.execute(sql`
      update ${priorityLevels}
      set rank = v.rank
      from (values ${sql.join(
        ids.map((id, rank) => sql`(${id}::int, ${rank}::int)`),
        sql`, `
      )}) as v(id, rank)
      where ${priorityLevels.projectId} = ${projectId}
        and ${priorityLevels.id} = v.id
    `);
  });

  return getPriorityLevels(projectId);
}

/**
 * Deletes a level, moving every track, collection and session that holds it
 * to `replaceWith` in the same transaction, so no row is ever without a
 * level. The default cannot go (another level is made the default first), a
 * level cannot replace itself, and the replacement must be of the same
 * project. The rows are repointed in plain SQL, leaving their `updated_at`
 * alone: the scale changed, not the rows, as when a status is deleted.
 */
export async function deletePriorityLevel(
  projectId: number,
  levelId: number,
  replaceWith: number,
  actorId: string
): Promise<void> {
  const deleted = await db.transaction(async (tx) => {
    const levels = await lockScale(tx, projectId);
    const level = levelIn(levels, levelId);
    if (level.isDefault) {
      throw new HTTPException(400, {
        message:
          "The default level cannot be deleted; make another level the default first",
      });
    }
    if (replaceWith === levelId) {
      throw new HTTPException(400, {
        message: "A level cannot replace itself",
      });
    }
    if (!levels.some((candidate) => candidate.id === replaceWith)) {
      throw new HTTPException(400, {
        message: "Replacement level not found in this project",
      });
    }

    for (const table of Object.values(LEVELLED_TABLES)) {
      await tx.execute(sql`
        update ${table}
        set ${sql.identifier(table.priorityId.name)} = ${replaceWith}
        where ${table.projectId} = ${projectId}
          and ${table.priorityId} = ${levelId}
      `);
    }
    await tx.delete(priorityLevels).where(eq(priorityLevels.id, levelId));
    return level;
  });

  await recordActivity({
    projectId,
    entityType: "project",
    entityId: projectId,
    userId: actorId,
    action: "updated",
    before: { priority: deleted.name },
    after: { priority: null },
  });
}
