import { sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { baseSchema } from "./base.js";
import { commitKindEnum, segmentSourceEnum } from "./enums.js";
import { projects } from "./projects.js";
import { machines } from "./machines.js";
import { saves } from "./saves.js";
import { sessions } from "./sessions.js";

/**
 * A dit repo: the history of one Live project folder, held by a project. Its
 * sets are sessions, its commits and objects the rows below and in
 * `objects.ts`.
 */
export const repos = pgTable(
  "repos",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastPushAt: timestamp("last_push_at"),
    lastPushMachineId: text("last_push_machine_id").references(
      (): AnyPgColumn => machines.id,
      { onDelete: "set null" }
    ),
    /** Whether dit pushes this repo's sample objects; the instance can force it on. */
    pushSamples: boolean("push_samples").notNull().default(false),
  },
  (t) => [unique("repo_project_name").on(t.projectId, t.name)]
);

export type Repo = typeof repos.$inferSelect;

export const repoSchema = createSelectSchema(repos);

/**
 * A line of commits within one session (a session is a set's lineage).
 * `headCommitId` and `commits.branchId` reference each other, so both are
 * lazy.
 */
export const branches = pgTable(
  "branches",
  {
    ...baseSchema,
    sessionId: integer("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    headCommitId: integer("head_commit_id").references(
      (): AnyPgColumn => commits.id,
      { onDelete: "set null" }
    ),
  },
  (t) => [unique("branch_session_name").on(t.sessionId, t.name)]
);

/**
 * One commit, naming the save that holds its content. History is linear:
 * `parentId` is the previous commit on the branch.
 */
export const commits = pgTable(
  "commits",
  {
    ...baseSchema,
    repoId: integer("repo_id")
      .references(() => repos.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: integer("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    branchId: integer("branch_id")
      .references(() => branches.id, { onDelete: "cascade" })
      .notNull(),
    hash: text("hash").notNull(),
    // No action rather than restrict: a save a commit names is history and
    // cannot be deleted directly, yet a session or project delete cascades to
    // both rows in one statement, and no action is checked at its end.
    saveId: integer("save_id")
      .references(() => saves.id, { onDelete: "no action" })
      .notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => commits.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    machineName: text("machine_name"),
    /** The machine that pushed the commit, when `machineName` is its name; null otherwise. */
    machineId: text("machine_id").references((): AnyPgColumn => machines.id, {
      onDelete: "set null",
    }),
    kind: commitKindEnum("kind").notNull(),
    committedAt: timestamp("committed_at").notNull(),
  },
  (t) => [
    unique("commit_repo_hash").on(t.repoId, t.hash),
    index("commit_session_time").on(t.sessionId, t.committedAt),
    index("commit_branch").on(t.branchId),
    index("commit_save").on(t.saveId),
    index("commit_parent").on(t.parentId),
    index("commit_machine").on(t.machineId),
  ]
);

/**
 * A span of time one machine had the set open on one branch, from the script,
 * log, title or saves that showed it. A span pushed again keeps its start and
 * the later of its ends, so a re-push never counts twice.
 */
export const timeSegments = pgTable(
  "time_segments",
  {
    ...baseSchema,
    sessionId: integer("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    branchId: integer("branch_id")
      .references(() => branches.id, { onDelete: "cascade" })
      .notNull(),
    machineName: text("machine_name").notNull(),
    /** The machine that pushed the span, when `machineName` is its name; null otherwise. */
    machineId: text("machine_id").references((): AnyPgColumn => machines.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at").notNull(),
    source: segmentSourceEnum("source").notNull(),
  },
  (t) => [
    unique("time_segment_key")
      .on(t.sessionId, t.branchId, t.machineName, t.machineId, t.startedAt)
      .nullsNotDistinct(),
    index("time_segment_branch").on(t.branchId, t.startedAt),
    check("time_segment_order", sql`${t.endedAt} >= ${t.startedAt}`),
  ]
);
