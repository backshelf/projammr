import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { baseSchema } from "./base.js";
import { projects } from "./projects.js";
import { SAMPLE_KINDS, SAMPLE_STATUSES } from "./samples.js";
import { sessions } from "./sessions.js";

/** @public drizzle-kit reads the enums this directory exports. */
export const sampleKindEnum = pgEnum("sample_kind", SAMPLE_KINDS);
/** @public drizzle-kit reads the enums this directory exports. */
export const sampleStatusEnum = pgEnum("sample_status", SAMPLE_STATUSES);

/** One sample a session file references; `position` keeps the file's order. */
export const sessionSamples = pgTable(
  "session_samples",
  {
    ...baseSchema,
    sessionId: integer("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    // Denormalised for the project-wide "which sets share this path" query;
    // a session move rewrites it alongside the session.
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    kind: sampleKindEnum("kind").notNull(),
    status: sampleStatusEnum("status").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("session_sample_path").on(t.sessionId, t.path),
    index("session_sample_project_path").on(t.projectId, t.path),
  ]
);
