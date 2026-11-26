import { and, count, eq, getTableColumns, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../index.js";
import { publicUserColumns, publicUserSchema, users } from "../schema/auth.js";
import { rawMemberRoleEnum } from "../schema/enums.js";
import { members, memberSchema } from "../schema/projects.js";
import { statuses } from "../schema/statuses.js";

export type MemberRole = (typeof rawMemberRoleEnum)[number];

/**
 * What resolving a request to a project can yield:
 * - a number: gate on membership in that project
 * - `null`: the target entity does not exist → 404
 *
 * Every scoped row carries a project, so a resolver that finds nothing has
 * found no row — there is no third state where a row exists outside a
 * project. Notes are the one exception: a note is gated by `loadNoteAccess`
 * in `db/queries/notes.ts`, not by an `authorizeProject` resolver, since its
 * author keeps it whether or not it is linked into a project at all.
 *
 * This is the raw "which project, if any" a query-layer lookup answers with.
 * `Scope` below is what a resolver actually hands `authorizeProject`: it says
 * what *kind* of thing a request targets, not just which project — the
 * distinction `ProjectResolution` alone cannot make.
 */
export type ProjectResolution = number | null;

/**
 * What a request targets, for `authorizeProject` (REST) and
 * `requireResolved` (MCP) to gate on. A resolver used to answer with a
 * `ProjectResolution` or the literal `"skip"`, and both a route that isn't
 * project-scoped at all and a body that simply named no project answered
 * `"skip"` the same way — the hole `POST /statuses` fell through. `Scope`
 * gives each of those cases its own value instead of overloading one:
 */
export type Scope =
  | { kind: "project"; id: number }
  /** A row one user owns outright: an avatar. Only that user passes. */
  | { kind: "user"; id: string }
  /** Seeded, instance-wide vocabulary. Anyone signed in reads; only an instance admin writes. */
  | { kind: "instance" }
  /** The route acts on no stored row: creating a project, reading one's own account. */
  | { kind: "none" }
  /** The target does not exist. */
  | null;

/** A `ProjectResolution` lifted into the `Scope` a gate dispatches on. */
export function projectScope(id: ProjectResolution): Scope {
  return id == null ? null : { kind: "project", id };
}

/**
 * Whether a user administers the instance itself: the seeded vocabulary every
 * project shares, the instance settings, and every account. The one answer both
 * gates read — `authorizeProject`'s `instance` branch for a write, and
 * `middleware/instance-admin.ts` for the whole `/admin/*` mount.
 *
 * Read from the row rather than from the session's copy of the user. The role
 * is on the session object (a Better Auth `additionalFields` entry), and Better
 * Auth's cookie cache carries it for as long as that cookie lives, so a
 * promotion or a demotion would take up to `session.cookieCache.maxAge` to
 * reach a gate reading it there. Authorization reads the row for the same
 * reason it reads `members` rather than a cached role.
 */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ instanceRole: users.instanceRole })
    .from(users)
    .where(eq(users.id, userId));
  return row?.instanceRole === "admin";
}

/**
 * Roles ranked low to high. A member satisfies a required role when their own
 * role's rank is at least the requirement's.
 */
const roleRank: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function roleSatisfies(role: MemberRole, minRole: MemberRole) {
  return roleRank[role] >= roleRank[minRole];
}

/**
 * The caller's role in a project, or null when they are not a member. One
 * query, reused by the route middleware and the static-file handler.
 */
export async function memberRole(
  userId: string,
  projectId: number
): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.projectId, projectId)));
  return row?.role ?? null;
}

export async function isMemberAtLeast(
  userId: string,
  projectId: number,
  minRole: MemberRole
) {
  const role = await memberRole(userId, projectId);
  return role != null && roleSatisfies(role, minRole);
}

/**
 * The caller's role in a project, gated at `minRole`: a non-member gets
 * `notFoundMessage` as a 404 (the same answer a nonexistent row gets, so a
 * caller outside the project cannot tell a real row from a missing one), and
 * a member below `minRole` gets a 403 naming the role they lack, since they
 * already know the row exists. Both `authorizeProject` and the MCP gates call
 * this so REST and MCP can't drift apart.
 */
export async function requireMembership(
  userId: string,
  projectId: number,
  minRole: MemberRole,
  notFoundMessage?: string
): Promise<MemberRole> {
  const role = await memberRole(userId, projectId);
  if (role == null) {
    throw new HTTPException(
      404,
      notFoundMessage == null ? undefined : { message: notFoundMessage }
    );
  }
  if (!roleSatisfies(role, minRole)) {
    throw new HTTPException(403, {
      message: `Requires project role: ${minRole}`,
    });
  }
  return role;
}

export const projectMemberSchema = memberSchema.extend({
  user: publicUserSchema.nullable(),
});

/**
 * Ownership is not handed out through member management — it moves only by
 * transfer, so the role a member can be set to stops one rung below.
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(rawMemberRoleEnum).exclude(["owner"]),
});

export async function getProjectMembers(projectId: number) {
  return db
    .select({ ...getTableColumns(members), user: publicUserColumns })
    .from(members)
    .leftJoin(users, eq(members.userId, users.id))
    .where(eq(members.projectId, projectId));
}

/** A table whose rows each belong to exactly one project. */
type ProjectScoped = { id: PgColumn; projectId: PgColumn };

/**
 * Every id must name a row of `table` inside `projectId`; otherwise 404, or
 * `status` for a route whose contract answers a bad id in a body as a bad
 * request. A missing row and a row in another project answer the same way, so
 * a caller cannot probe another project's id space through the error.
 *
 * One statement whatever the number of ids: a count short of the distinct ids
 * asked about means at least one of them was missing or foreign.
 *
 * The scoping column is named separately from the id column because a project
 * is its own scope: its module points both at the primary key.
 */
export async function assertScoped(
  table: PgTable,
  idColumn: PgColumn,
  projectColumn: PgColumn,
  ids: readonly (number | null | undefined)[],
  projectId: number,
  what: string,
  status: 400 | 404 = 404
): Promise<void> {
  const distinct = [...new Set(ids.filter((id) => id != null))];
  if (distinct.length === 0) return;

  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(and(inArray(idColumn, distinct), eq(projectColumn, projectId)));

  if (Number(row?.value) !== distinct.length) {
    throw notInProject(what, status);
  }
}

/** The error a write answers for an id that is missing or another project's. */
export function notInProject(
  what: string,
  status: 400 | 404 = 404
): HTTPException {
  return new HTTPException(status, {
    message: `${what} not found in this project`,
  });
}

/** `assertScoped` for the ordinary case: a table with a `project_id` column. */
export function assertInProject(
  table: PgTable & ProjectScoped,
  ids: readonly (number | null | undefined)[],
  projectId: number,
  what: string,
  status: 400 | 404 = 404
): Promise<void> {
  return assertScoped(
    table,
    table.id,
    table.projectId,
    ids,
    projectId,
    what,
    status
  );
}

/**
 * A status is usable by a project when it is the project's own or a seeded
 * global one, which every project shares.
 */
export async function isStatusUsable(
  statusId: number,
  projectId: number
): Promise<boolean> {
  const [row] = await db
    .select({ projectId: statuses.projectId })
    .from(statuses)
    .where(eq(statuses.id, statusId));

  return row != null && (row.projectId == null || row.projectId === projectId);
}

/** {@link isStatusUsable} as a gate: a status the project cannot use is a 404. */
export async function assertStatusUsable(
  statusId: number | null | undefined,
  projectId: number
): Promise<void> {
  if (statusId == null) return;

  if (!(await isStatusUsable(statusId, projectId))) {
    throw new HTTPException(404, {
      message: "Status not found in this project",
    });
  }
}

export type AssignableRole = Exclude<MemberRole, "owner">;

export type MemberChange =
  { kind: "role"; role: AssignableRole } | { kind: "remove" };

/**
 * The rank rule for granting: an actor may hand out a role no higher than
 * their own. Membership changes and invitations both answer to it.
 */
export function assertMayGrant(actorRole: MemberRole, granted: MemberRole) {
  if (roleRank[actorRole] < roleRank[granted]) {
    throw new HTTPException(403, {
      message: "Cannot grant a role above your own",
    });
  }
}

/**
 * Applies a membership change under the rank rule: the actor must outrank or
 * equal both the target's current role and the role being assigned. The
 * project's member rows are locked for the whole transaction, so two
 * concurrent demotions cannot both pass the last-owner check — the second
 * blocks, re-reads, and sees the count the first left behind.
 */
export async function changeMembership(
  projectId: number,
  actorId: string,
  targetUserId: string,
  change: MemberChange
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ userId: members.userId, role: members.role })
      .from(members)
      .where(eq(members.projectId, projectId))
      .for("update");

    const actor = rows.find((row) => row.userId === actorId);
    const target = rows.find((row) => row.userId === targetUserId);
    if (!actor) throw new HTTPException(403);
    if (!target) throw new HTTPException(404);

    if (roleRank[actor.role] < roleRank[target.role]) {
      throw new HTTPException(403, {
        message: "Cannot change a member who outranks you",
      });
    }
    if (change.kind === "role") assertMayGrant(actor.role, change.role);

    const owners = rows.filter((row) => row.role === "owner").length;
    const losesAnOwner = target.role === "owner";
    if (losesAnOwner && owners <= 1) {
      throw new HTTPException(409, {
        message: "A project must keep at least one owner",
      });
    }

    const where = and(
      eq(members.projectId, projectId),
      eq(members.userId, targetUserId)
    );

    if (change.kind === "remove") {
      const [removed] = await tx.delete(members).where(where).returning();
      return removed!;
    }

    const [updated] = await tx
      .update(members)
      .set({ role: change.role })
      .where(where)
      .returning();
    return updated!;
  });
}

/**
 * Hands ownership from one member to another already-a-member. The caller
 * becomes admin; the target becomes owner. The project's member rows are
 * locked for the whole transaction, so two concurrent transfers cannot both
 * read "owner" for the caller and promote a target.
 */
export async function transferOwnership(
  projectId: number,
  fromUserId: string,
  toUserId: string
) {
  if (fromUserId === toUserId) {
    throw new HTTPException(400, { message: "Already the owner" });
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ userId: members.userId, role: members.role })
      .from(members)
      .where(eq(members.projectId, projectId))
      .for("update");

    const from = rows.find((row) => row.userId === fromUserId);
    if (from?.role !== "owner") throw new HTTPException(403);
    if (!rows.some((row) => row.userId === toUserId)) {
      throw new HTTPException(404, { message: "Not a member" });
    }

    await tx
      .update(members)
      .set({ role: "owner" })
      .where(
        and(eq(members.projectId, projectId), eq(members.userId, toUserId))
      );

    const [previous] = await tx
      .update(members)
      .set({ role: "admin" })
      .where(
        and(eq(members.projectId, projectId), eq(members.userId, fromUserId))
      )
      .returning();
    return previous!;
  });
}
