import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { repos } from "./repos.js";
import { saves } from "./saves.js";

/**
 * A content-addressed object, named by its hash. Rows are referenced, never
 * owned: `save_objects` and `repo_objects` restrict their delete, so an object
 * nothing references is one with no row in either, which is what retention and
 * accounting look for.
 */
export const objects = pgTable("objects", {
  hash: text("hash").primaryKey(),
  kind: smallint("kind").notNull(),
  /** Bytes of the stored file. */
  size: bigint("size", { mode: "number" }).notNull(),
});

/** The objects one save rebuilds from. */
export const saveObjects = pgTable(
  "save_objects",
  {
    saveId: integer("save_id")
      .references(() => saves.id, { onDelete: "cascade" })
      .notNull(),
    objectHash: text("object_hash")
      .references(() => objects.hash, { onDelete: "restrict" })
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.saveId, t.objectHash] }),
    index("save_object_hash").on(t.objectHash),
  ]
);

/**
 * The sample objects a commit's own save references and the hub holds. Kept
 * apart from `save_objects` because that table is read whole to rebuild the
 * set, and a sample is megabytes the rebuild must never load. Only the
 * commit's own save is linked, which bounds the rows, and the links restrict
 * the object's delete as `save_objects` does.
 */
export const saveSampleObjects = pgTable(
  "save_sample_objects",
  {
    saveId: integer("save_id")
      .references(() => saves.id, { onDelete: "cascade" })
      .notNull(),
    objectHash: text("object_hash")
      .references(() => objects.hash, { onDelete: "restrict" })
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.saveId, t.objectHash] }),
    index("save_sample_object_hash").on(t.objectHash),
  ]
);

/** The objects a repo holds, and who pushed each. */
export const repoObjects = pgTable(
  "repo_objects",
  {
    repoId: integer("repo_id")
      .references(() => repos.id, { onDelete: "cascade" })
      .notNull(),
    objectHash: text("object_hash")
      .references(() => objects.hash, { onDelete: "restrict" })
      .notNull(),
    pushedBy: text("pushed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    pushedAt: timestamp("pushed_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.repoId, t.objectHash] }),
    index("repo_object_hash").on(t.objectHash, t.pushedAt, t.repoId),
  ]
);
