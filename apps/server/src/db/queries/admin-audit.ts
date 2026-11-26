import { inArray } from "drizzle-orm";
import { db } from "../index.js";
import { users } from "../schema/auth.js";
import { adminAudit } from "../schema/admin-audit.js";
import type { AdminAuditAction } from "../schema/admin-audit.js";

/** The pool, or a transaction on it — a caller passes its own `tx` so the audit row shares the change's transaction. */
type Database = Pick<typeof db, "select" | "insert">;

/** What one admin action names about who did it and who it was about. */
export type RecordAdminActionParams = {
  action: AdminAuditAction;
  actorId: string;
  targetUserId: string;
  /** Action-specific detail, e.g. `{ from: "user", to: "admin" }` for a role change. */
  detail?: Record<string, unknown>;
};

/**
 * Writes one `admin_audit` row, snapshotting the actor's and target's current
 * email and name onto it. The snapshot — not a join at read time — is what
 * keeps the row answering "who did this, and who was it about" after either
 * account is later deleted, since `actorId`/`targetUserId` carry no cascade.
 *
 * Both accounts must still exist when this runs: for account deletion, the
 * caller writes the row before the `users` row goes (`account-deletion.ts`,
 * `auth.ts`'s `beforeDelete`), never after.
 */
export async function recordAdminAction(
  { action, actorId, targetUserId, detail }: RecordAdminActionParams,
  database: Database = db
): Promise<void> {
  const ids = [...new Set([actorId, targetUserId])];
  const rows = await database
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const actor = byId.get(actorId);
  const target = byId.get(targetUserId);
  if (!actor || !target) {
    throw new Error(
      `recordAdminAction: actor or target not found (actor=${actorId}, target=${targetUserId})`
    );
  }

  await database.insert(adminAudit).values({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    actorName: actor.name,
    targetUserId: target.id,
    targetEmail: target.email,
    targetName: target.name,
    detail: detail ?? null,
  });
}
