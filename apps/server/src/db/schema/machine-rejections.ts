import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { users } from "./auth.js";
import { deviceIdSchema, machines } from "./machines.js";

/**
 * What a render rejection says. `not-a-bounce` is a file that is no bounce of
 * a song, named by its fingerprint and shared by every machine of the user;
 * `never-here` is a folder one machine is never to look for renders in.
 */
const RENDER_REJECTION_KINDS = ["not-a-bounce", "never-here"] as const;

/** @public drizzle-kit reads the enums this directory exports. */
export const renderRejectionKindEnum = pgEnum(
  "render_rejection_kind",
  RENDER_REJECTION_KINDS
);

/**
 * What the user told dit's render finder to leave alone, kept on the hub so it
 * follows them across machines. A `not-a-bounce` row has a `fingerprint` (the
 * file's size and a hash of its first and last 64 KiB, which the hub stores and
 * never interprets) and the file name it was seen under, if known; a
 * `never-here` row has the `machineId` it is for and the `folder`. Each is
 * stored once: a fingerprint per user, a folder per machine.
 */
export const renderRejections = pgTable(
  "render_rejections",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: renderRejectionKindEnum("kind").notNull(),
    fingerprint: text("fingerprint"),
    fileName: text("file_name"),
    machineId: text("machine_id").references(() => machines.id, {
      onDelete: "cascade",
    }),
    folder: text("folder"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("render_rejections_bounce")
      .on(t.userId, t.fingerprint)
      .where(sql`${t.kind} = 'not-a-bounce'`),
    uniqueIndex("render_rejections_folder")
      .on(t.machineId, t.folder)
      .where(sql`${t.kind} = 'never-here'`),
    index("render_rejections_user").on(t.userId),
    check(
      "render_rejections_fields_by_kind",
      sql`(${t.kind} = 'not-a-bounce' AND ${t.fingerprint} IS NOT NULL AND ${t.machineId} IS NULL AND ${t.folder} IS NULL)
        OR (${t.kind} = 'never-here' AND ${t.machineId} IS NOT NULL AND ${t.folder} IS NOT NULL AND ${t.fingerprint} IS NULL AND ${t.fileName} IS NULL)`
    ),
  ]
);

/** The render fingerprint, bounded rather than parsed. */
const fingerprintSchema = z.string().min(1).max(128);

/** The most rejections one write may carry. */
const MAX_REJECTIONS_PER_WRITE = 1000;

/** One rejection a client writes. */
const newRejectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("not-a-bounce"),
    fingerprint: fingerprintSchema,
    fileName: z.string().min(1).max(1024).optional(),
  }),
  z.object({
    kind: z.literal("never-here"),
    machineId: deviceIdSchema,
    folder: z.string().min(1).max(4096),
  }),
]);
export type NewRejection = z.infer<typeof newRejectionSchema>;

export const writeRejectionsSchema = z.object({
  items: z.array(newRejectionSchema).max(MAX_REJECTIONS_PER_WRITE),
});

/** A "Not a bounce" file, shared by every machine of the user. */
export const notABounceSchema = z.object({
  id: z.number().int(),
  fingerprint: z.string(),
  fileName: z.string().nullable(),
  createdAt: z.date(),
});

/** A "Never here" folder of one machine. */
const neverHereSchema = z.object({
  id: z.number().int(),
  machineId: z.string(),
  folder: z.string(),
});

/** The caller's rejections of both kinds. */
export const rejectionsSchema = z.object({
  notABounce: z.array(notABounceSchema),
  neverHere: z.array(neverHereSchema),
});
export type Rejections = z.infer<typeof rejectionsSchema>;

/** A rejection as the hub stores it, whichever its kind. */
const storedRejectionSchema = z.discriminatedUnion("kind", [
  notABounceSchema.extend({ kind: z.literal("not-a-bounce") }),
  neverHereSchema.extend({ kind: z.literal("never-here") }),
]);

/** What a write answers: the stored rows of the rejections it named, in its order. */
export const writtenRejectionsSchema = z.object({
  items: z.array(storedRejectionSchema),
});
export type WrittenRejections = z.infer<typeof writtenRejectionsSchema>;
