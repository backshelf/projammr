import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { baseSchema } from "./base.js";
import { contentStateEnum, saveSourceEnum } from "./enums.js";
import { projects } from "./projects.js";
import { machines } from "./machines.js";
import { branches } from "./repos.js";
import type { SampleRef } from "./samples.js";
import { type Session, sessions } from "./sessions.js";

/**
 * What a session file looked like at one save: the DAW-derived columns a
 * session row itself carries.
 */
export type SaveMeta = Pick<
  Session,
  | "tempo"
  | "timeSignature"
  | "rootNote"
  | "scale"
  | "tracksCount"
  | "scenesCount"
  | "dawVersion"
  | "structure"
> & { samplePaths: string[] | null; samples?: SampleRef[] };

export const saves = pgTable(
  "saves",
  {
    ...baseSchema,
    sessionId: integer("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    // Denormalised for the project heatmap query; sessions never change
    // project except via move, which rewrites this alongside the session.
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    // The file's own mtime (or the timestamp in a backup's name) — the one
    // value monotonic with the edit.
    fileUpdatedAt: timestamp("file_updated_at").notNull(),
    fingerprint: text("fingerprint"),
    machineName: text("machine_name"),
    /**
     * The machine that made a save dit pushed, when its name was that of the
     * machine that pushed it; null for a save the scanner recorded and for one
     * naming another machine. History keeps the reference after the machine
     * is removed.
     */
    machineId: text("machine_id").references((): AnyPgColumn => machines.id, {
      onDelete: "set null",
    }),
    source: saveSourceEnum("source").notNull(),
    meta: jsonb("meta").$type<SaveMeta>(),
    // The save's dit object id, the hash of its XML, and the ids of the tree
    // and side objects it rebuilds from (hex); all null on a save that came
    // from the scanner and carries no content.
    hash: text("hash"),
    xmlHash: text("xml_hash"),
    tree: text("tree"),
    side: text("side"),
    // The id of the leaf holding the file's bytes, on a save dit could not
    // read; null on every save that rebuilds from a tree and side.
    raw: text("raw"),
    viewOnly: boolean("view_only").notNull().default(false),
    unreadable: boolean("unreadable").notNull().default(false),
    contentState: contentStateEnum("content_state").notNull().default("none"),
    /** The dit branch the save was committed on, null for one the scanner recorded. */
    branchId: integer("branch_id").references((): AnyPgColumn => branches.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("save_session_time").on(t.sessionId, t.fileUpdatedAt),
    index("save_project_time").on(t.projectId, t.fileUpdatedAt),
    index("save_branch").on(t.branchId),
    index("save_machine").on(t.machineId),
    uniqueIndex("save_session_hash")
      .on(t.sessionId, t.hash)
      .where(sql`${t.hash} is not null`),
  ]
);

export type Save = typeof saves.$inferSelect;
export type NewSave = typeof saves.$inferInsert;
