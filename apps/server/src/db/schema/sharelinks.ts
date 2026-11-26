import {
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { baseSchema } from "./base.js";
import { trackAudios } from "./tracks.js";

export const SHARELINK_ENTITIES = ["collection", "track"] as const;
export const SHARELINK_TYPES = ["snapshot", "connected"] as const;
/** @public drizzle-kit reads the enums this directory exports. */
export const sharelinkEntityEnum = pgEnum(
  "sharelink_entity",
  SHARELINK_ENTITIES
);

/** @public drizzle-kit reads the enums this directory exports. */
export const sharelinkTypeEnum = pgEnum("sharelink_type", SHARELINK_TYPES);

export const sharelinks = pgTable(
  "sharelinks",
  {
    ...baseSchema,
    token: text("token").unique().notNull(),
    // Postgres' own `infinity` sentinel round-trips through node-postgres as
    // a nonsense finite date rather than a real Date, so "no expiry" is a
    // concrete far-future timestamp instead — the "set to max" the product
    // spec calls for, without relying on infinity support the driver doesn't
    // have.
    expiresAt: timestamp("expires_at")
      .notNull()
      .default(sql`'9999-12-31 23:59:59+00'`),
    entityType: sharelinkEntityEnum("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    description: text("description"),
    isCommentsPrivate: boolean("is_comments_private").notNull().default(false),
    isDownloadsEnabled: boolean("is_downloads_enabled")
      .notNull()
      .default(false),
    shareType: sharelinkTypeEnum("share_type").notNull(),
    snapshotTitle: text("snapshot_title"),
    // Set when the owner turns the link off and never cleared; null is live.
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("sharelinks_token").on(t.token)]
);

export const sharelinkSnapshotTrackAudios = pgTable(
  "sharelink_snapshot_track_audios",
  {
    ...baseSchema,
    trackAudioId: integer("track_audio_id")
      .notNull()
      .references(() => trackAudios.id, { onDelete: "cascade" }),
    sharelinkId: integer("sharelink_id")
      .notNull()
      .references(() => sharelinks.id, { onDelete: "cascade" }),
    title: text("title"),
    image: text("image"),
    position: integer("position"),
  },
  (t) => [
    primaryKey({ columns: [t.sharelinkId, t.trackAudioId] }),
    unique("dedupe_sharelink_track_numbers").on(t.sharelinkId, t.position),
    index("sharelink_snapshot_track").on(t.trackAudioId),
  ]
);

export type Sharelink = typeof sharelinks.$inferSelect;

// The revoke timestamp never travels: a revoked link answers 410 and every
// other link's is null.
export const sharelinkSchema = createSelectSchema(sharelinks).omit({
  revokedAt: true,
});
