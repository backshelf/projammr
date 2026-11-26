import { integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { baseSchema } from "./base.js";
import { projects } from "./projects.js";

/**
 * A project's relation types: the ordered list of nouns a track relation is
 * one of ("remix", "live version"), each completing "this track is a … of"
 * another. Every track relation points at one of its own project's types, so
 * a type in use cannot be deleted.
 */
export const trackRelationTypes = pgTable(
  "track_relation_types",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    /**
     * The type's place in the project's list, 0 first. Not unique: two types
     * appended at once may share a rank, and the list then orders them by id.
     */
    rank: integer("rank").notNull(),
  },
  (t) => [
    uniqueIndex("track_relation_types_project_name").on(t.projectId, t.name),
  ]
);

export type TrackRelationType = typeof trackRelationTypes.$inferSelect;

/**
 * A type as every relation carries it. The one schema every relation
 * response reuses, so the API documents it once.
 */
export const relationTypeSchema = createSelectSchema(trackRelationTypes)
  .pick({ id: true, name: true })
  .meta({ id: "RelationType" });

/** A type as the list's own writes answer it: with its place in the list. */
export const rankedRelationTypeSchema = relationTypeSchema.extend({
  rank: z.number().int(),
});

export type RankedRelationType = z.infer<typeof rankedRelationTypeSchema>;
