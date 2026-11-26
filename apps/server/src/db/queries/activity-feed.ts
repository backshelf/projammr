import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { comments } from "../schema/comments.js";
import { publicUserMask } from "../schema/auth.js";
import { ENTITIES } from "../../entities/index.js";
import { activityTargetSchema, type ActivityTarget } from "./activity.js";

/** `getProjectActivity`'s options, as a caller passes them: a route's query params or a tool's input. */
export const activityQuerySchema = z.object({
  entityType: activityTargetSchema.optional(),
  entityId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Display names for the entities a set of activity rows refers to, keyed
 * `<entityType>:<entityId>`. Each entity module names its own table and name
 * column, so this is one query per entity type present rather than one per row
 * — and never a mapping table of its own.
 *
 * Reading the registry (`ENTITIES`) belongs to the feed alone: every entity's
 * own query layer writes activity rows through `./activity.js`, which knows
 * nothing about the registry, so that a query module can log its own writes
 * without importing the registry that in turn imports it back.
 */
async function resolveEntityNames(
  rows: { entityType: ActivityTarget; entityId: number }[]
): Promise<Map<string, string>> {
  const idsByType = new Map<ActivityTarget, Set<number>>();
  for (const row of rows) {
    const ids = idsByType.get(row.entityType) ?? new Set<number>();
    ids.add(row.entityId);
    idsByType.set(row.entityType, ids);
  }

  const names = new Map<string, string>();

  await Promise.all(
    [...idsByType].map(async ([entityType, ids]) => {
      const { table, nameColumn } = ENTITIES[entityType];
      const found = await db
        .select({ id: table.id, name: nameColumn })
        .from(table)
        .where(inArray(table.id, [...ids]));

      for (const row of found) {
        names.set(`${entityType}:${row.id}`, String(row.name));
      }
    })
  );

  return names;
}

/** How much of a comment a feed row quotes before it is cut short. */
const EXCERPT_LENGTH = 160;

function excerpt(content: string): string {
  const text = content.trim();
  return text.length > EXCERPT_LENGTH
    ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : text;
}

/**
 * The quoted comment for each `commented` row, keyed by comment id. Read at
 * query time rather than copied at write time, so an edited comment quotes its
 * current text.
 */
async function resolveComments(
  ids: number[]
): Promise<Map<number, { excerpt: string; positionMs: number | null }>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: comments.id,
      content: comments.content,
      positionMs: comments.positionMs,
    })
    .from(comments)
    .where(inArray(comments.id, ids));

  return new Map(
    rows.map((row) => [
      row.id,
      { excerpt: excerpt(row.content), positionMs: row.positionMs },
    ])
  );
}

/**
 * Recent activity in a project, newest first. Filters to one entity when
 * `entityType` + `entityId` are given. Each row carries the name of the entity
 * it describes, so a feed can say "Low Tide" rather than "track #4", and a
 * `commented` row carries an excerpt of the comment it quotes.
 */
export async function getProjectActivity(
  projectId: number,
  opts: { entityType?: ActivityTarget; entityId?: number; limit?: number } = {}
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = await db.query.activity.findMany({
    where:
      opts.entityType && opts.entityId
        ? {
            projectId,
            entityType: opts.entityType,
            entityId: opts.entityId,
          }
        : { projectId },
    with: { user: { columns: publicUserMask } },
    orderBy: { createdAt: "desc" },
    limit,
  });

  const [names, quoted] = await Promise.all([
    resolveEntityNames(rows),
    resolveComments(
      rows.map((row) => row.commentId).filter((id) => id !== null)
    ),
  ]);

  return rows.map((row) => ({
    ...row,
    entityName: names.get(`${row.entityType}:${row.entityId}`) ?? null,
    comment: row.commentId ? (quoted.get(row.commentId) ?? null) : null,
  }));
}
