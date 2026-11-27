import { and, eq, isNull, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { db } from "../index.js";
import { activity } from "../schema/activity.js";
import { comments } from "../schema/comments.js";
import { members, projects } from "../schema/projects.js";
import { notes } from "../schema/notes.js";
import { ENTITIES } from "../../entities/index.js";
import { recordAdminAction } from "./admin-audit.js";
import { invalidateMembershipCache } from "./authorization.js";
import { removeUserImages } from "./images.js";
import { lockAdminsAndTarget } from "./instance-users.js";

/** The pool, or a transaction on it. */
type Database = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute" | "transaction"
>;

/** One project the account owns, as {@link deletionPlan} classifies it. */
const deletionPlanProjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  memberCount: z.number().int(),
});
type DeletionPlanProject = z.infer<typeof deletionPlanProjectSchema>;

/**
 * What deleting the account would do to the projects it owns, before
 * anything runs: {@link deleteAccount} refuses outright while `blocking` is
 * non-empty, and takes every project in `deleted` with it, files included.
 */
export const deletionPlanSchema = z.object({
  blocking: z.array(deletionPlanProjectSchema),
  deleted: z.array(deletionPlanProjectSchema),
});
export type DeletionPlan = z.infer<typeof deletionPlanSchema>;

/**
 * Every project the account owns outright, with how many members each one
 * has. Ownership is singular per project (`transferOwnership` is the only way
 * it moves), so this is also every project a deletion has to reckon with —
 * one the account merely edits or views loses nothing but its own membership,
 * which cascades away with the `users` row.
 */
async function projectsOwnedBy(
  userId: string,
  database: Pick<typeof db, "select"> = db
): Promise<DeletionPlanProject[]> {
  const rows = await database
    .select({
      id: projects.id,
      name: projects.name,
      memberCount: sql<number>`(
        select count(*)::int from members m2 where m2.project_id = ${projects.id}
      )`,
    })
    .from(projects)
    .innerJoin(
      members,
      and(
        eq(members.projectId, projects.id),
        eq(members.userId, userId),
        eq(members.role, "owner")
      )
    );

  return rows;
}

/**
 * What stands between the account and deletion, and what goes with it.
 * `blocking` projects share other members, so ownership has to be
 * transferred before the account can go; `deleted` projects have no one else
 * in them, so they are the account's own and go with it.
 */
export async function deletionPlan(
  userId: string,
  database: Pick<typeof db, "select"> = db
): Promise<DeletionPlan> {
  const owned = await projectsOwnedBy(userId, database);
  return {
    blocking: owned.filter((project) => project.memberCount > 1),
    deleted: owned.filter((project) => project.memberCount === 1),
  };
}

/**
 * Runs everything account deletion needs beyond dropping the `users` row
 * itself, which Better Auth does immediately after this returns (`beforeDelete`,
 * `auth.ts`) — so nothing here touches that row.
 *
 * Refuses with 409 while a shared project still needs its ownership
 * transferred, and refuses the instance's last sign-in-capable admin
 * outright, reading that through the same lock `changeInstanceUser` takes so
 * the two agree on who that is. The lock cannot be held across the decision,
 * though: the `users` row goes when Better Auth's own delete runs after this
 * returns, so a concurrent demotion that starts after this commits can still
 * take the last admin away. `scripts/make-admin.ts` is the way back from
 * that. Otherwise: every solely-owned project is
 * deleted through the ordinary project delete, which always runs on the pool
 * rather than `database` (files and storage usage
 * included — that delete owns its own consistency and cannot run inside a
 * shared transaction, so it runs first, on its own), then the account's own
 * images (its avatars) are removed on the same terms, files and storage usage
 * included — `images_scope_owner` forbids a user-scoped image without an
 * owner, so the `users` row's `set null` would otherwise fail the delete — then
 * the account's comments and activity are detached rather than lost (nulling `userId`
 * renders them as "Deleted user" instead of cascading them away, since
 * `comments.userId` cascades on delete and `activity.userId` would otherwise
 * beat this to it), and finally its notes that link to no project — including
 * ones the project deletes above just unlinked — are dropped; a note the
 * account authored on a project it does not own is not reachable from here
 * and is swept up by the `users` row's own cascade instead.
 */
export async function deleteAccount(
  userId: string,
  database: Database = db
): Promise<void> {
  const plan = await deletionPlan(userId, database);
  if (plan.blocking.length > 0) {
    throw new APIError("CONFLICT", {
      message:
        "Transfer ownership of these projects before you can delete your account",
      blocking: plan.blocking,
    });
  }

  // The transaction is here for the consistent read, not for serialisation:
  // it commits — releasing the lock — before the deletion goes ahead, because
  // the delete itself belongs to Better Auth and happens after this function
  // returns. Checking early is still the right order, since the project
  // deletes below are irreversible and must not run for an account that turns
  // out to be refused.
  const isOnlySignInCapableAdmin = await database.transaction(async (tx) => {
    const result = await lockAdminsAndTarget(tx, userId);
    return result.isOnlySignInCapableAdmin;
  });
  if (isOnlySignInCapableAdmin) {
    throw new APIError("CONFLICT", {
      message: "The instance must keep one admin who can sign in",
    });
  }

  for (const project of plan.deleted) {
    await ENTITIES.project.remove(project.id);
  }

  await removeUserImages(userId, database);

  await database.transaction(async (tx) => {
    // The audit row belongs to the same transaction as the detaching below,
    // so a project delete that threw above leaves no row claiming a deletion
    // that never happened. It still runs well before Better Auth drops the
    // `users` row after this function returns, which is what
    // `recordAdminAction` needs: actor and target are the same account here,
    // and both must exist for it to snapshot their email and name.
    await recordAdminAction(
      {
        action: "account_self_deleted",
        actorId: userId,
        targetUserId: userId,
      },
      tx
    );
    await tx
      .update(comments)
      .set({ userId: null })
      .where(eq(comments.userId, userId));
    await tx
      .update(activity)
      .set({ userId: null })
      .where(eq(activity.userId, userId));
    await tx
      .delete(notes)
      .where(and(eq(notes.authorId, userId), isNull(notes.trackId)));
  });

  invalidateMembershipCache(userId);
}
