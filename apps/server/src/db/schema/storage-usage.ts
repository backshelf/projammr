import {
  bigint,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { rawStorageScopeEnum, storageScopeEnum } from "./enums.js";

/**
 * How many bytes of stored files one scope is holding.
 *
 * The counter is maintained beside the row that owns the bytes, so an upload
 * or a delete moves it in the same breath; a nightly audit re-derives it from
 * the rows and logs whatever it had drifted by. It is a cache of a sum, never
 * the source of truth.
 *
 * `scopeId` is text because the two scopes are keyed differently — a project
 * by its integer id, a user by the string Better Auth gave them — so no
 * foreign key can cover the column. The audit is what removes the row of a
 * scope that no longer exists.
 */
export const storageUsage = pgTable(
  "storage_usage",
  {
    scopeKind: storageScopeEnum("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    /** Never negative: a subtraction that would go below zero clamps instead. */
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeKind, t.scopeId] })]
);

export type StorageScopeKind = (typeof rawStorageScopeEnum)[number];

/**
 * What a scope is using and what it is allowed, as every storage readout
 * reports it. `limitBytes` is null where the instance sets no cap, which is
 * the default.
 */
export const storageReportSchema = z.object({
  scopeKind: z.enum(rawStorageScopeEnum),
  scopeId: z.string(),
  /** The project's or account's name, where the scope still exists. */
  name: z.string().nullable().optional(),
  usedBytes: z.number(),
  limitBytes: z.number().nullable(),
});

export type StorageReport = z.infer<typeof storageReportSchema>;

/**
 * A project's storage report, which also says how much of `usedBytes` is the
 * objects its repos hold.
 */
export const projectStorageReportSchema = storageReportSchema.extend({
  repositoryBytes: z.number(),
});
