import { isNotNull, isNull } from "drizzle-orm";
import {
  integer,
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
import { baseSchema, baseSchemaIgnores } from "./base.js";
import { projects } from "./projects.js";

export const statuses = pgTable(
  "statuses",
  {
    ...baseSchema,
    name: varchar("name", { length: 255 }).notNull(),
    percentage: integer("percentage").default(0).notNull(),
    description: text("description"),
    colourHex: varchar("colour_hex", { length: 9 })
      .default("#8A8A8A")
      .notNull(),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    // A name is unique within its project, so two projects may each have an
    // "In Progress". Seeded statuses carry no project and are unique among
    // themselves; they need their own index because Postgres treats NULL
    // project ids as distinct and would not constrain them otherwise.
    uniqueIndex("statuses_project_name")
      .on(t.projectId, t.name)
      .where(isNotNull(t.projectId)),
    uniqueIndex("statuses_global_name").on(t.name).where(isNull(t.projectId)),
  ]
);

export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;

export const statusSchema = createSelectSchema(statuses);
/**
 * `projectId` is nullable in the column only for the seeded global rows,
 * which the API never creates (they come from a migration); every status a
 * caller can `POST` belongs to a project, so the create schema requires it —
 * a body naming none would resolve to "not project-scoped" and write an
 * instance-wide status.
 */
export const newStatusSchema = createInsertSchema(statuses)
  .omit(baseSchemaIgnores)
  .extend({ projectId: z.number() });

/** A status stays in the project it was created for, so `projectId` is fixed. */
export const editStatusSchema = createUpdateSchema(statuses).omit({
  ...baseSchemaIgnores,
  projectId: true,
});
