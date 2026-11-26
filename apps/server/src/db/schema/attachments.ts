import {
  index,
  integer,
  pgTable,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { assets } from "./assets.js";
import { baseSchema, baseTimestamps } from "./base.js";
import { collections } from "./collections.js";
import { projects } from "./projects.js";
import { sessions } from "./sessions.js";
import { tracks } from "./tracks.js";

export const sessionAttachments = pgTable(
  "session_attachments",
  {
    ...baseSchema,
    sessionId: integer("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    assetId: integer("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    unique("session_asset").on(t.sessionId, t.assetId),
    index("session_attachments_asset").on(t.assetId),
  ]
);

export const trackAttachments = pgTable(
  "track_attachments",
  {
    ...baseTimestamps,
    trackId: integer("track_id").references(() => tracks.id, {
      onDelete: "cascade",
    }),
    assetId: integer("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.assetId] })]
);

export const trackAttachmentSchema = createSelectSchema(trackAttachments);

export const collectionAttachments = pgTable(
  "collection_attachments",
  {
    ...baseSchema,
    collectionId: integer("collection_id").references(() => collections.id, {
      onDelete: "cascade",
    }),
    assetId: integer("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    unique("collection_asset").on(t.collectionId, t.assetId),
    index("collection_attachments_collection").on(t.collectionId),
    index("collection_attachments_asset").on(t.assetId),
  ]
);

export const projectAttachments = pgTable(
  "project_attachments",
  {
    ...baseSchema,
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    assetId: integer("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    unique("project_asset").on(t.projectId, t.assetId),
    index("project_attachments_project").on(t.projectId),
    index("project_attachments_asset").on(t.assetId),
  ]
);
