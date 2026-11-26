import { z } from "zod";
import { errorFields, log } from "../../lib/log.js";
import { db } from "../index.js";
import {
  activity,
  activitySchema,
  type NewActivity,
} from "../schema/activity.js";
import { publicUserSchema } from "../schema/auth.js";
import { rawEntityKindEnum } from "../schema/enums.js";

const logger = log("activity");

export const activityTargetSchema = z.enum(rawEntityKindEnum);

export type ActivityTarget = (typeof rawEntityKindEnum)[number];

export const activityWithUserSchema = activitySchema.extend({
  user: publicUserSchema.nullable(),
  /**
   * The entity's display name at read time. Null when the row it described
   * has since been deleted, which is expected for `deleted` actions.
   */
  entityName: z.string().nullable(),
  /** The quoted comment on a `commented` row, read at query time. */
  comment: z
    .object({ excerpt: z.string(), positionMs: z.number().nullable() })
    .nullable(),
});

const IGNORED_FIELDS = new Set([
  "updatedAt",
  "createdAt",
  "id",
  // Generated from `notes`/`description`; recording it beside the block
  // array it derives from would print the note's whole body in the feed.
  "notesText",
]);

/**
 * A row's custom values ride in a `fields` bag keyed `cf_<id>`, where a value
 * that is not set is absent rather than null.
 */
const FIELD_BAG = "fields";

const isBag = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The fields that changed between two versions of a row, as
 * `{ field: { from, to } }`. Timestamps and the id are never reported, and
 * neither is any field named in `ignoredFields` — a caller's way of keeping
 * its own machine-written columns (a session's scanned fingerprint, say) out
 * of the feed. When both versions carry a `fields` bag, each custom value
 * reports as its own `cf_<id>` change, a cleared one included; a bag on one
 * side only (a write that answers the bare row) reports nothing.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignoredFields?: readonly string[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const record = (key: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes[key] = { from: a ?? null, to: b ?? null };
    }
  };
  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key) || ignoredFields?.includes(key)) continue;
    if (key === FIELD_BAG) {
      const from = before[key];
      const to = after[key];
      if (!isBag(from) || !isBag(to)) continue;
      for (const field of new Set([...Object.keys(from), ...Object.keys(to)])) {
        record(field, from[field], to[field]);
      }
      continue;
    }
    record(key, before[key], after[key]);
  }
  return changes;
}

type RecordActivityInput = {
  projectId: number | null;
  entityType: ActivityTarget;
  entityId: number;
  userId: string | null;
  action: NewActivity["action"];
  /** For `updated`: the row before and after, to diff. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Fields to leave out of the diff, on top of the timestamps and id. */
  ignoredFields?: readonly string[];
  /** For `commented`: the comment the row quotes. */
  commentId?: number;
};

/**
 * Appends one activity row. An `updated` action with no field changes (e.g. a
 * no-op patch) is dropped rather than recorded. Never throws — a failure to log
 * must not fail the mutation it describes.
 */
export async function recordActivity(
  input: RecordActivityInput
): Promise<void> {
  try {
    let changes: NewActivity["changes"] = null;
    if (input.action === "updated" && input.before && input.after) {
      const diff = diffFields(input.before, input.after, input.ignoredFields);
      if (Object.keys(diff).length === 0) return;
      changes = diff;
    }

    await db.insert(activity).values({
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId,
      action: input.action,
      changes,
      commentId: input.commentId ?? null,
    });
  } catch (err) {
    logger.error("failed to record activity", errorFields(err));
  }
}

/**
 * Appends one row per entry in a single insert, for an action that carries no
 * diff — a bulk delete names the rows it removed and nothing else. Never
 * throws, for the same reason `recordActivity` does not.
 */
export async function recordActivityBatch(
  rows: Omit<
    RecordActivityInput,
    "before" | "after" | "ignoredFields" | "commentId"
  >[]
): Promise<void> {
  if (rows.length === 0) return;

  try {
    await db.insert(activity).values(
      rows.map((row) => ({
        projectId: row.projectId,
        entityType: row.entityType,
        entityId: row.entityId,
        userId: row.userId,
        action: row.action,
      }))
    );
  } catch (err) {
    logger.error("failed to record activity", errorFields(err));
  }
}

/** One entity's before/after, for `recordActivityDiffs`. */
export type ActivityDiffInput = {
  projectId: number | null;
  entityType: ActivityTarget;
  entityId: number;
  userId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** Fields to leave out of the diff, on top of the timestamps and id. */
  ignoredFields?: readonly string[];
};

/**
 * Appends one `updated` row per entry, each diffed against its own before/after
 * rather than one shared diff — a bulk patch that sets the same field on ten
 * rows still records what each row actually had before, and a row the patch
 * left unchanged (already at the target value) is dropped, the same as a
 * single `recordActivity` call would drop it. Never throws, for the same
 * reason `recordActivity` does not.
 */
export async function recordActivityDiffs(
  rows: ActivityDiffInput[]
): Promise<void> {
  if (rows.length === 0) return;

  const values: NewActivity[] = [];
  for (const row of rows) {
    const changes = diffFields(row.before, row.after, row.ignoredFields);
    if (Object.keys(changes).length === 0) continue;
    values.push({
      projectId: row.projectId,
      entityType: row.entityType,
      entityId: row.entityId,
      userId: row.userId,
      action: "updated",
      changes,
    });
  }
  if (values.length === 0) return;

  try {
    await db.insert(activity).values(values);
  } catch (err) {
    logger.error("failed to record activity", errorFields(err));
  }
}
