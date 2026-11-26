import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import { z } from "zod";
import { publicUserSchema, users } from "./auth.js";
import { baseSchema, baseSchemaIgnores } from "./base.js";
import { savedViewKindEnum } from "./enums.js";
import { projects } from "./projects.js";

/**
 * A named table view: a saved combination of filters, sort, visible columns and
 * grouping for one entity kind in a project. `config.query` is the table URL
 * query string the view restores; the client owns its shape. A view belongs to
 * the member who saved it and is private to them until they share it; names
 * are unique per project, kind and owner. The owner is the user, not their
 * membership, so a member who leaves keeps their views.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    ownerId: text("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    shared: boolean("shared").notNull().default(false),
    name: varchar("name", { length: 255 }).notNull(),
    kind: savedViewKindEnum("kind").notNull(),
    config: jsonb("config").$type<{ query: string }>().notNull(),
  },
  (t) => [
    uniqueIndex("saved_views_project_kind_owner_name").on(
      t.projectId,
      t.kind,
      t.ownerId,
      t.name
    ),
  ]
);

export type SavedView = typeof savedViews.$inferSelect;

const savedViewConfigSchema = z.object({ query: z.string() });

export const savedViewSchema = createSelectSchema(savedViews).extend({
  config: savedViewConfigSchema,
});
/** A listed view, with the member who owns it. */
export const savedViewWithOwnerSchema = savedViewSchema.extend({
  owner: publicUserSchema.pick({ id: true, name: true }),
});
export type SavedViewWithOwner = z.infer<typeof savedViewWithOwnerSchema>;

/** A saved view is created private, owned by the caller; sharing is an edit. */
export const newSavedViewSchema = createInsertSchema(savedViews)
  .omit({ ...baseSchemaIgnores, projectId: true, ownerId: true, shared: true })
  .extend({ config: savedViewConfigSchema });
export const editSavedViewSchema = createUpdateSchema(savedViews)
  .omit({ ...baseSchemaIgnores, projectId: true, ownerId: true, kind: true })
  .extend({ config: savedViewConfigSchema.optional() });
