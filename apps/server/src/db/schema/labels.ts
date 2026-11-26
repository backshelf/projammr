import {
  index,
  integer,
  pgTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { baseSchema } from "./base.js";
import { labelTargetEnum } from "./enums.js";
import { projects } from "./projects.js";

/**
 * A project's label vocabulary — free-form multi-select tags ("needs vocals",
 * "sample clearance") an editor defines once and applies to any number of
 * tracks, collections, and sessions. A name is unique within its project.
 */
export const labels = pgTable(
  "labels",
  {
    ...baseSchema,
    name: varchar("name", { length: 255 }).notNull(),
    colourHex: varchar("colour_hex", { length: 9 })
      .default("#94A3B8")
      .notNull(),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [uniqueIndex("labels_project_name").on(t.projectId, t.name)]
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;

export const labelSchema = createSelectSchema(labels);

/**
 * Polymorphic join: one label applied to one entity. `entityType` +
 * `entityId` name the target; there is no FK to the target row (Postgres has
 * no polymorphic FK), so each entity's delete path clears its own rows.
 */
export const entityLabels = pgTable(
  "entity_labels",
  {
    labelId: integer("label_id")
      .references(() => labels.id, { onDelete: "cascade" })
      .notNull(),
    entityType: labelTargetEnum("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.labelId, t.entityType, t.entityId] }),
    index("entity_labels_entity").on(t.entityType, t.entityId),
  ]
);
