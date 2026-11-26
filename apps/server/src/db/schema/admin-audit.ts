import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { adminAuditActionEnum, rawAdminAuditActionEnum } from "./enums.js";

/**
 * A queryable record of what an admin did to an account: a reset link
 * issued, a role change, a disable/enable, or the account's own deletion.
 * Kept separate from `activity` (project-scoped, keyed to `rawEntityKindEnum`
 * with an integer id) rather than widening it, since an instance-level event
 * on a Better Auth `text` user id has no natural place in a table whose every
 * other row belongs to a project.
 *
 * `actorId`/`targetUserId` have no `ON DELETE CASCADE` — a row must survive
 * either account being deleted later, admin or target — so both are
 * `ON DELETE SET NULL` and the identifying details are snapshotted onto the
 * row at write time. A null id on its own would tell a reader nothing; the
 * snapshot is what still answers "who did this" and "who was it about" after
 * the account is gone.
 */
export const adminAudit = pgTable("admin_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  action: adminAuditActionEnum("action").notNull(),
  actorId: text("actor_id").references(() => users.id, {
    onDelete: "set null",
  }),
  actorEmail: text("actor_email").notNull(),
  actorName: text("actor_name").notNull(),
  targetUserId: text("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  targetEmail: text("target_email").notNull(),
  targetName: text("target_name").notNull(),
  /** Action-specific detail, e.g. `{ from: "user", to: "admin" }` for a role change. */
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AdminAuditAction = (typeof rawAdminAuditActionEnum)[number];
