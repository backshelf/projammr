import {
  boolean,
  bytea,
  index,
  integer,
  pgTable,
  smallint,
  text,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import type { KeyScope } from "../../lib/notes-crypto.js";
import { users } from "./auth.js";
import { baseSchema } from "./base.js";
import { tracks } from "./tracks.js";

export const notes = pgTable(
  "notes",
  {
    ...baseSchema,
    authorId: text("author_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    trackId: integer("track_id")
      .references(() => tracks.id, { onDelete: "set null" })
      .unique(),

    lyricsMode: boolean("lyrics_mode").notNull().default(true),
    pinned: boolean("pinned").notNull().default(false),

    /**
     * Optimistic-concurrency counter, bumped on every content write. An
     * `updatedAt` precondition doesn't work here: `now()` carries microsecond
     * precision that a JSON round trip through the client can't preserve, so
     * an equality check on the timestamp would fail on every save.
     */
    version: integer("version").notNull().default(1),

    /** The scope the wrapped key is under, as `notes-crypto` derives it. */
    keyScope: text("key_scope").$type<KeyScope>().notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    wrappedKey: bytea("wrapped_key").notNull(),

    /** Sealed JSON of the block array. */
    body: bytea("body").notNull(),
    /** Sealed JSON `{ title, preview }` so the list never opens a body. */
    summary: bytea("summary").notNull(),
  },
  (t) => [index("notes_author_updated").on(t.authorId, t.updatedAt)]
);

export type Note = typeof notes.$inferSelect;

/**
 * The row shape as the wire is allowed to see it — no ciphertext or
 * key-scope metadata ever leaves the server through this schema.
 */
export const noteSchema = createSelectSchema(notes).omit({
  wrappedKey: true,
  body: true,
  summary: true,
  keyScope: true,
  keyVersion: true,
});
