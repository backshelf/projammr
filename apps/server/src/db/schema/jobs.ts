import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { users } from "./auth.js";
import { baseSchema } from "./base.js";
import {
  jobKindEnum,
  jobStatusEnum,
  rawJobKindEnum,
  rawJobStatusEnum,
} from "./enums.js";
import { projects } from "./projects.js";

/** One rung of the ladder a kind of job climbs. Weights are relative. */
const jobStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number(),
});

export type JobStep = z.infer<typeof jobStepSchema>;

/**
 * One unit of background work — transcoding an asset, analysing an audio file,
 * walking a project's audios. The row outlives the request that queued it, so a
 * client can follow its progress and a restart can pick the work back up.
 *
 * `subjectId` is whatever the kind is about: an asset for `convert`, a track
 * audio for `audio_analysis`, a project for `audio_backfill`, an image for
 * `image_variants`. `result` holds both the parameters the job was queued with
 * and whatever it produced, so a finished job can still be matched against a
 * repeat request. A job that belongs to a project names it, and that is what
 * gates reading it; instance maintenance (`storage_audit`,
 * `save_content_sweep`) belongs to no project and is readable through no
 * project's routes.
 *
 * Progress is the runner's to write: `steps` is the kind's ladder, copied onto
 * the row when a run claims it, `stepIndex`/`stepPercent` say where the run is
 * on it, and `percent` is the whole job's completion derived from the two.
 */
export const jobs = pgTable(
  "jobs",
  {
    ...baseSchema,
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    kind: jobKindEnum("kind").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    subjectId: integer("subject_id"),
    /** Overall completion, 0..100. */
    percent: real("percent").notNull().default(0),
    steps: jsonb("steps").$type<JobStep[]>().notNull().default([]),
    /** 0-based index into `steps`; null until a run claims the row. */
    stepIndex: integer("step_index"),
    /** Completion of the current step, 0..100; null until a run claims the row. */
    stepPercent: real("step_percent"),
    /** 1-based place in the process's queue; null unless waiting in it. */
    queuePosition: integer("queue_position"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    /** How many times the job has been run, including the current attempt. */
    attempts: integer("attempts").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("jobs_project_status").on(t.projectId, t.status),
    index("jobs_finished_at").on(t.projectId, t.finishedAt),
  ]
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobKind = (typeof rawJobKindEnum)[number];
export type JobStatus = (typeof rawJobStatusEnum)[number];

/**
 * A job as the API sends it: the row plus the names the server derives on
 * read. `label` names the kind; `subjectLabel` names what the job is about.
 */
export const jobSchema = createSelectSchema(jobs).extend({
  result: z.record(z.string(), z.unknown()).nullable(),
  steps: z.array(jobStepSchema),
  label: z.string(),
  subjectLabel: z.string().nullable(),
});

export type DescribedJob = Job & { label: string; subjectLabel: string | null };

/** What a route that queues work answers with: the job to poll at `GET /jobs/:id`. */
export const queuedJobSchema = z.object({ jobId: z.number() });
