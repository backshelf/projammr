import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import { users } from "./auth.js";
import { baseSchema, baseSchemaIgnores } from "./base.js";
import { commentTargetEnum } from "./enums.js";
import { projects } from "./projects.js";

// Self-referencing FK: column without .references() to avoid TS circular inference.
// The FK is added via foreignKey() in the extra config callback instead.
export const comments = pgTable(
  "comments",
  {
    ...baseSchema,
    targetType: commentTargetEnum("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    /**
     * The project the target belongs to, denormalised so a search can filter
     * on it directly. Deriving it means joining every target type in turn,
     * which leaves the predicate unindexable and scans other projects' rows.
     * The server fills it from the authorized project; it is never client-set.
     */
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    parentId: integer("parent_id"),
    positionMs: integer("position_ms"),
    /** When the comment was resolved; null means it is open. */
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("comments_target").on(t.targetType, t.targetId),
    index("comments_project").on(t.projectId),
    index("comments_parent").on(t.parentId),
    index("comments_user").on(t.userId),
    index("comments_content_trgm").using("gin", t.content.op("gin_trgm_ops")),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete(
      "cascade"
    ),
  ]
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

/** Columns only the resolve routes write, so neither create nor edit can set them. */
const commentResolveIgnores = { resolvedAt: true, resolvedBy: true } as const;

export const commentSchema = createSelectSchema(comments);
export const newCommentSchema = createInsertSchema(comments).omit({
  ...baseSchemaIgnores,
  ...commentResolveIgnores,
  // Derived from the authorized project, so a caller cannot file a comment
  // under a project it targets nothing in.
  projectId: true,
});
export const editCommentSchema = createUpdateSchema(comments).omit({
  ...baseSchemaIgnores,
  ...commentResolveIgnores,
  projectId: true,
});
