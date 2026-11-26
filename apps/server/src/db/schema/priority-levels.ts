import { eq } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { baseSchema } from "./base.js";
import { projects } from "./projects.js";

/**
 * A project's priority scale: an ordered list of levels, each with a name and
 * a colour, one of them the default a new track, collection or session takes.
 * Every row of those three tables points at one of its own project's levels,
 * so the scale is never empty and a level only goes by naming the level its
 * rows move to.
 */
export const priorityLevels = pgTable(
  "priority_levels",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    /** The level's place on the scale, 0 at the bottom. */
    rank: integer("rank").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [
    uniqueIndex("priority_levels_project_name").on(t.projectId, t.name),
    // Not deferrable, so a reorder clears every rank before it writes the
    // new ones.
    uniqueIndex("priority_levels_project_rank").on(t.projectId, t.rank),
    // At most one default per project; the writes keep it at exactly one.
    uniqueIndex("priority_levels_project_default")
      .on(t.projectId)
      .where(eq(t.isDefault, true)),
  ]
);

export type PriorityLevel = typeof priorityLevels.$inferSelect;
export type NewPriorityLevel = typeof priorityLevels.$inferInsert;

/**
 * A level as every track, collection and session row carries it. The one
 * schema every entity response reuses, so the API documents it once.
 */
export const priorityLevelSchema = createSelectSchema(priorityLevels)
  .pick({ id: true, name: true, colour: true, rank: true })
  .meta({ id: "PriorityLevel" });

/** A level as the scale's own routes answer it: which one is the default, too. */
export const scaleLevelSchema = priorityLevelSchema.extend({
  isDefault: z.boolean(),
});

export type ScaleLevel = z.infer<typeof scaleLevelSchema>;
