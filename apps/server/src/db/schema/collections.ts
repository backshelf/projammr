import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import { z } from "zod";
import {
  type BlockDocument,
  baseSchema,
  baseSchemaIgnores,
  blockDocumentSchema,
  imageIgnores,
  scopeIgnores,
} from "./base.js";
import { priorityLevels } from "./priority-levels.js";
import { projects } from "./projects.js";
import { statuses } from "./statuses.js";
import { tracks } from "./tracks.js";

export const collections = pgTable(
  "collections",
  {
    ...baseSchema,
    title: text("title").notNull(),

    notes: jsonb("notes").$type<BlockDocument>(),
    notesText: text("notes_text").generatedAlwaysAs(
      sql`regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\\[|\\]$|"', '', 'g')`
    ),

    /** A level of the project's own priority scale; see `tracks.priorityId`. */
    priorityId: integer("priority_id")
      .references(() => priorityLevels.id, { onDelete: "restrict" })
      .notNull(),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    image: text("image"),
    statusId: integer("status_id")
      .default(1)
      .references(() => statuses.id, { onDelete: "set default" }),

    releaseDate: date("release_date"),

    upc: varchar("upc", { length: 26 }),
  },
  (t) => [
    index("collections_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
    index("collections_upc_trgm").using("gin", t.upc.op("gin_trgm_ops")),
    index("collections_notes_text_trgm").using(
      "gin",
      t.notesText.op("gin_trgm_ops")
    ),
    index("collections_project_updated").on(t.projectId, t.updatedAt),
    index("collections_status").on(t.statusId),
    index("collections_priority").on(t.priorityId),
  ]
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

// A pg `date` column round-trips as a bare `YYYY-MM-DD` string (mode
// "string", drizzle-zod's default): the regex pins the shape, the refine
// rejects a shape-valid date that isn't a real one (`2026-02-30`). Output
// stays a string — no `z.date()` transform — so the wire contract and the
// generated OpenAPI types don't change.
const releaseDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "must be a real calendar date");

export const collectionSchema = createSelectSchema(collections)
  .omit({ notes: true })
  .extend({ notes: blockDocumentSchema.nullable() });
export const newCollectionSchema = createInsertSchema(collections)
  .omit({ ...baseSchemaIgnores, ...imageIgnores, notes: true })
  .extend({
    title: z.string().trim().min(1),
    notes: blockDocumentSchema.nullish(),
    releaseDate: releaseDateSchema.nullable().optional(),
    // Omitted, the project's default level applies.
    priorityId: z.number().int().optional(),
  });
export const editCollectionSchema = createUpdateSchema(collections)
  .omit({ ...baseSchemaIgnores, ...scopeIgnores, ...imageIgnores, notes: true })
  .extend({
    title: z.string().trim().min(1).optional(),
    notes: blockDocumentSchema.nullish(),
    releaseDate: releaseDateSchema.nullable().optional(),
  });

export const collectionTracks = pgTable(
  "collection_tracks",
  {
    collectionId: integer("collection_id")
      .references(() => collections.id, { onDelete: "cascade" })
      .notNull(),
    trackId: integer("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    trackNumber: integer("track_number"),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.trackId] }),
    unique("dedupe_track_numbers").on(t.collectionId, t.trackNumber),
    // The primary key leads with `collection_id`, so it cannot serve the
    // lookups that start from a track: its collections, and the artwork chain.
    index("collection_tracks_track").on(t.trackId),
  ]
);

export const collectionTrackSchema = createSelectSchema(collectionTracks);
export const newCollectionTrackSchema = createInsertSchema(collectionTracks);
