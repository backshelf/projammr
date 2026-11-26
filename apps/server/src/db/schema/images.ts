import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  real,
  text,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { users } from "./auth.js";
import { baseSchema } from "./base.js";
import { imageScopeEnum, rawImageScopeEnum } from "./enums.js";
import { projects } from "./projects.js";

export const images = pgTable(
  "images",
  {
    ...baseSchema,
    name: text("name").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    /**
     * The stored file's key, relative to the static root — `images/<uuid>.<ext>`.
     * The `image` column on a project, collection or track holds this same
     * string, so a cover resolves by plain equality; `storedFilePath` and
     * `staticUrl` render it for disk and for the wire.
     */
    assetPath: text("image_path").notNull().unique(),
    createdByUser: text("created_by_user").references(() => users.id, {
      onDelete: "set null",
    }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    scope: imageScopeEnum("scope").notNull().default("project"),
    /**
     * Whether every width in `VARIANT_WIDTHS` has been resized. The
     * outstanding-work finder reads this instead of stat-ing each width of
     * each image at every boot; the storage audit corrects it from what is
     * actually on disk.
     */
    variantsReady: boolean("variants_ready").notNull().default(false),
    /**
     * Bytes the cached resizes of this image take, counted towards the same
     * scopes as the original. Recorded as each variant is written, so the
     * usage counters can be re-derived from rows alone.
     */
    variantBytes: integer("variant_bytes").notNull().default(0),
    accentHue: real("accent_hue"),
    accentChroma: real("accent_chroma"),
    accentHex: text("accent_hex"),
  },
  (t) => [
    index("images_created_by").on(t.createdByUser),
    index("images_project").on(t.projectId),
    // Images are the one table where a null project is legitimate: an avatar
    // belongs to its uploader, and an instance image to the instance, not to a
    // project. Every row must therefore name an owner of the kind its scope
    // claims, so no image can end up belonging to nobody the way a plain
    // nullable column allows. An instance image outlives the admin who
    // uploaded it, so it names no one. Its scope is compared as text: the
    // migrator applies pending migrations in one transaction, and Postgres
    // refuses an enum value added in the same transaction as an enum literal.
    check(
      "images_scope_owner",
      sql`(${t.scope} = 'project' AND ${t.projectId} IS NOT NULL)
        OR (${t.scope} = 'user' AND ${t.createdByUser} IS NOT NULL)
        OR (${t.scope}::text = 'instance' AND ${t.projectId} IS NULL)`
    ),
  ]
);

export type ImageScope = (typeof rawImageScopeEnum)[number];

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;

export const imageSchema = createSelectSchema(images);
