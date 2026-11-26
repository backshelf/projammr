import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { users } from "./auth.js";
import { comments } from "./comments.js";
import { activityActionEnum, activityTargetEnum } from "./enums.js";
import { projects } from "./projects.js";

/**
 * An append-only trail of who changed what and when. Rows are immutable, so
 * there is no `updatedAt`. `entityId` has no FK — a row must outlive the entity
 * it describes so a `deleted` action stays readable. `changes` is populated for
 * `updated` actions only: `{ field: { from, to } }` for each field that moved.
 */
export const activity = pgTable(
  "activity",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    entityType: activityTargetEnum("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: activityActionEnum("action").notNull(),
    changes:
      jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    /**
     * The comment a `commented` row describes. The excerpt is read through
     * this rather than copied, so an edited comment reads correctly and a
     * deleted one takes its activity row with it.
     */
    commentId: integer("comment_id").references(
      (): AnyPgColumn => comments.id,
      {
        onDelete: "cascade",
      }
    ),
  },
  (t) => [
    index("activity_entity").on(t.entityType, t.entityId),
    index("activity_project").on(t.projectId, t.createdAt),
    index("activity_comment").on(t.commentId),
  ]
);

export type NewActivity = typeof activity.$inferInsert;

export const activitySchema = createSelectSchema(activity).extend({
  changes: z
    .record(z.string(), z.object({ from: z.unknown(), to: z.unknown() }))
    .nullable(),
});
