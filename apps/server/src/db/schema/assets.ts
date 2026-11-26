import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { users } from "./auth.js";
import { baseSchema } from "./base.js";
import { rawEntityKindEnum } from "./enums.js";
import { projects } from "./projects.js";

export const assets = pgTable(
  "assets",
  {
    ...baseSchema,
    name: text("name").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    assetPath: text("asset_path").notNull(),
    createdByUser: text("created_by_user").references(() => users.id, {
      onDelete: "set null",
    }),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),

    localFilepath: text("local_filepath"),
    localFileCreatedAt: timestamp("local_file_created_at"),
    localFileUpdatedAt: timestamp("local_file_updated_at"),
    localFileMachineName: text("local_file_machine_name"),
    fingerprint: text("fingerprint"),
  },
  (t) => [
    index("assets_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
    index("assets_project_fingerprint").on(t.projectId, t.fingerprint),
    // Every `/static` request resolves a stored path to its row, and one file
    // belongs to exactly one asset.
    uniqueIndex("assets_path").on(t.assetPath),
    index("assets_created_by").on(t.createdByUser),
  ]
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const assetSchema = createSelectSchema(assets);

const uploadedBySchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

/** An asset as an entity's attachment: the row plus who uploaded it. */
export const attachedAssetSchema = assetSchema.extend({
  uploadedBy: uploadedBySchema.nullable(),
});

/**
 * The `with` clause an entity read passes for its `attachments` relation, so
 * each attachment carries the `uploadedBy` that `attachedAssetSchema` names.
 */
export const attachmentsWithUploadedBy = {
  with: { uploadedBy: { columns: { id: true, name: true, image: true } } },
} as const;

/** An asset plus the uploader and attachment context the files table shows. */
export const assetWithContextSchema = assetSchema.extend({
  uploadedBy: uploadedBySchema.nullable(),
  attachments: z.array(
    z.object({
      kind: z.enum(rawEntityKindEnum),
      id: z.number(),
      title: z.string(),
    })
  ),
});

/**
 * A fingerprint the scanner asked about, resolved to the asset already holding
 * that content and the sessions it is attached to.
 */
export const assetFingerprintMatchSchema = z.object({
  fingerprint: z.string(),
  assetId: z.number(),
  name: z.string(),
  sessionIds: z.array(z.number()),
});
