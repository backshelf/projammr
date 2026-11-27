import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../index.js";
import { authSessions, users, type InstanceRole } from "../schema/auth.js";
import { rawInstanceRoleEnum } from "../schema/enums.js";
import { storageUsage } from "../schema/storage-usage.js";
import { recordAdminAction } from "./admin-audit.js";
import { revokeUserSessions } from "./auth-sessions.js";
import { invalidateMembershipCache } from "./authorization.js";
import { offsetOf, pageResponseSchema } from "./pagination.js";

/**
 * An account as the instance administration surface reads it: the contact
 * detail no collaborator's view carries, plus the three figures that say what
 * the account is actually doing on the instance.
 */
export const instanceUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  instanceRole: z.enum(rawInstanceRoleEnum),
  createdAt: z.date(),
  /** The last time any session of theirs was touched; null if never signed in. */
  lastSeenAt: z.date().nullable(),
  /** Everything they have uploaded, across every project, plus their avatar. */
  storageBytes: z.number(),
  projectCount: z.number().int(),
  disabled: z.boolean(),
});

export type InstanceUser = z.infer<typeof instanceUserSchema>;

export const instanceUsersSchema = pageResponseSchema(instanceUserSchema);

/** What may be changed about an account from `PATCH /admin/users/:id`. */
export const instanceUserPatchSchema = z
  .object({
    instanceRole: z.enum(rawInstanceRoleEnum),
    disabled: z.boolean(),
  })
  .partial();

export type InstanceUserPatch = z.infer<typeof instanceUserPatchSchema>;

/**
 * The pool, or a drizzle instance bound to another database — which is how the
 * tests exercise the last-admin rule on an instance whose admins they own.
 */
type Database = Pick<
  typeof db,
  "select" | "insert" | "execute" | "transaction"
>;

/**
 * `users.isAnonymous` is nullable, so `= false` misses a row holding NULL. A
 * share-page guest is a session, not an account, and never appears in the
 * admin list.
 */
const nonAnonymous = sql`${users.isAnonymous} is not true`;

/*
 * Both correlated subqueries spell their tables out by hand. A single-table
 * select renders its columns unqualified, so an interpolated `${users.id}`
 * inside a subquery over another table comes out as a bare `"id"` and resolves
 * against *that* table — `auth_sessions.id`, not the row being counted for.
 */
const lastSeenAt = sql<Date | null>`(
  select max(s.updated_at) from auth_sessions as s where s.user_id = users.id
)`.mapWith(authSessions.updatedAt);

const projectCount = sql<number>`(
  select count(*)::int from members as m where m.user_id = users.id
)`;

/**
 * The accounts matching `where`, oldest first — the order they claimed the
 * instance in, which puts whoever set it up at the top. Each row's storage
 * counter is joined directly on `(scope_kind = 'user', scope_id = users.id)`
 * so reading one page or one user never scans every project and account on the
 * instance.
 */
async function readInstanceUsers(
  database: Database,
  where: SQL,
  limit?: { pageSize: number; offset: number }
): Promise<InstanceUser[]> {
  const page = database
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      instanceRole: users.instanceRole,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
      lastSeenAt,
      projectCount,
      storageBytes: sql<number>`coalesce(${storageUsage.bytes}, 0)`.mapWith(
        Number
      ),
    })
    .from(users)
    .leftJoin(
      storageUsage,
      and(
        eq(storageUsage.scopeKind, "user"),
        eq(storageUsage.scopeId, users.id)
      )
    )
    .where(where)
    .orderBy(asc(users.createdAt), asc(users.id))
    .$dynamic();

  const rows = await (limit
    ? page.limit(limit.pageSize).offset(limit.offset)
    : page);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    instanceRole: row.instanceRole,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    storageBytes: row.storageBytes,
    projectCount: row.projectCount,
    disabled: row.disabledAt != null,
  }));
}

/** One page of the instance's accounts, and how many there are in total. */
export async function listInstanceUsers(
  page: number,
  pageSize: number
): Promise<z.infer<typeof instanceUsersSchema>> {
  const [rows, [total]] = await Promise.all([
    readInstanceUsers(db, nonAnonymous, {
      pageSize,
      offset: offsetOf(page, pageSize),
    }),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(users)
      .where(nonAnonymous),
  ]);

  return { rows, rowCount: total?.value ?? 0, page, pageSize };
}

/** One account by its Better Auth id, 404 when there is none. */
export async function getInstanceUser(
  userId: string,
  database: Database = db
): Promise<InstanceUser> {
  const [row] = await readInstanceUsers(database, eq(users.id, userId));
  if (!row) throw new HTTPException(404, { message: "User not found" });
  return row;
}

/** Lightweight account identity lookup for actions like issuing a password reset link. */
export async function getAccountIdentity(
  userId: string,
  database: Database = db
): Promise<{ id: string; email: string }> {
  const [row] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new HTTPException(404, { message: "User not found" });
  return row;
}

/**
 * The Better Auth id behind an email address, or null when no account holds
 * it. For the CLI scripts, which have no signed-in admin to resolve `:id`
 * from and start with only the address an operator typed.
 */
export async function findAccountIdByEmail(
  email: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  return row?.id ?? null;
}

/** A locked `users` row, as {@link lockAdminsAndTarget} reads it. */
type AdminLockRow = {
  id: string;
  instanceRole: InstanceRole;
  disabledAt: Date | null;
};

/**
 * Locks every admin row plus `userId`'s own row, `FOR UPDATE` in id order so
 * two concurrent changes cannot deadlock on each other, and answers whether
 * `userId` is the instance's only admin who can still sign in — the rule a
 * role change ({@link changeInstanceUser}) and an account deletion
 * (`db/queries/account-deletion.ts`) must agree on, so both call this rather
 * than each counting admins its own way. Must run inside the caller's own
 * transaction: the lock is only as good as the transaction holding it.
 */
export async function lockAdminsAndTarget(
  tx: Database,
  userId: string
): Promise<{
  rows: AdminLockRow[];
  target: AdminLockRow;
  isOnlySignInCapableAdmin: boolean;
}> {
  const rows = await tx
    .select({
      id: users.id,
      instanceRole: users.instanceRole,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(or(eq(users.instanceRole, "admin"), eq(users.id, userId)))
    .orderBy(asc(users.id))
    .for("update");

  const target = rows.find((row) => row.id === userId);
  if (!target) throw new HTTPException(404, { message: "User not found" });

  const admins = rows.filter(
    (row) => row.instanceRole === "admin" && row.disabledAt == null
  );
  const isOnlySignInCapableAdmin =
    admins.length === 1 && admins[0]?.id === target.id;

  return { rows, target, isOnlySignInCapableAdmin };
}

/**
 * Applies an admin's change to one account: its instance role, whether it is
 * disabled, or both.
 *
 * The instance must keep an admin who can actually sign in, so a change that
 * would leave none — demoting or disabling the last enabled admin — is refused
 * with 409.
 *
 * Disabling revokes the account's sessions in the same transaction: the flag is
 * what stops a session resolving, and dropping the rows is what stops one being
 * refreshed. A demotion revokes them too, for the same reason in a weaker
 * form: `/me` hands the client the session's copy of the role, so a session
 * that outlives the demotion keeps the admin shell on screen. A promotion
 * never revokes — nobody is signed out for being given more.
 *
 * A role change and a disable/enable each write their own `admin_audit` row
 * in the same transaction as the change, so a patch touching both produces
 * two distinct records rather than one vague "updated".
 */
export async function changeInstanceUser(
  userId: string,
  patch: InstanceUserPatch,
  actorId: string,
  database: Database = db
): Promise<InstanceUser> {
  await database.transaction(async (tx) => {
    const { target, isOnlySignInCapableAdmin } = await lockAdminsAndTarget(
      tx,
      userId
    );

    const instanceRole: InstanceRole =
      patch.instanceRole ?? target.instanceRole;
    const disabled = patch.disabled ?? target.disabledAt != null;

    if (isOnlySignInCapableAdmin && (instanceRole !== "admin" || disabled)) {
      throw new HTTPException(409, {
        message: "The instance must keep one admin who can sign in",
      });
    }

    await tx
      .update(users)
      .set({
        instanceRole,
        // An already-disabled account keeps the moment it was disabled.
        disabledAt: disabled ? (target.disabledAt ?? new Date()) : null,
      })
      .where(eq(users.id, userId));

    const demoted = target.instanceRole === "admin" && instanceRole !== "admin";
    if (disabled || demoted) await revokeUserSessions(userId, tx);

    const wasDisabled = target.disabledAt != null;
    if (
      patch.instanceRole !== undefined &&
      patch.instanceRole !== target.instanceRole
    ) {
      await recordAdminAction(
        {
          action: "role_changed",
          actorId,
          targetUserId: userId,
          detail: { from: target.instanceRole, to: instanceRole },
        },
        tx
      );
    }
    if (patch.disabled !== undefined && patch.disabled !== wasDisabled) {
      await recordAdminAction(
        {
          action: patch.disabled ? "account_disabled" : "account_enabled",
          actorId,
          targetUserId: userId,
        },
        tx
      );
    }
  });

  if (patch.disabled !== undefined) {
    invalidateMembershipCache(userId);
  }

  return getInstanceUser(userId, database);
}
