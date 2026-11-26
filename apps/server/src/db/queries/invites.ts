import { and, eq, getTableColumns, gt, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../index.js";
import { DAY_MS } from "../../lib/duration.js";
import { betterAuthUrl, emailEnabled } from "../../lib/env.js";
import { ApiError } from "../../lib/http.js";
import { sendMail } from "../../lib/mail.js";
import { inviteEmail } from "../../lib/mail-templates.js";
import { users } from "../schema/auth.js";
import { rawMemberRoleEnum } from "../schema/enums.js";
import {
  invites,
  inviteSchema,
  members,
  projects,
} from "../schema/projects.js";
import { instanceValues } from "./settings.js";
import {
  type AssignableRole,
  assertMayGrant,
  type MemberRole,
  type ProjectResolution,
  roleSatisfies,
} from "./authorization.js";
import { projectPolicy } from "./project-policy.js";

export const invitePreviewSchema = z.object({
  role: z.enum(rawMemberRoleEnum),
  projectName: z.string(),
  invitedByName: z.string().nullable(),
  email: z.string(),
  expired: z.boolean(),
  accepted: z.boolean(),
});

/**
 * The public view of an invite, keyed by its token: what the acceptance page
 * needs to say what is being joined, before the invitee has signed in. It
 * carries the invited address so the page can lock sign-up and sign-in to it —
 * the invitee registers with the one the invite names. The token is still the
 * only capability: whoever holds the link is shown the address.
 */
export async function getInvitePreview(token: string) {
  const [row] = await db
    .select({
      role: invites.role,
      email: invites.email,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      projectName: projects.name,
      invitedByName: users.name,
    })
    .from(invites)
    .innerJoin(projects, eq(invites.projectId, projects.id))
    .leftJoin(users, eq(invites.invitedBy, users.id))
    .where(eq(invites.token, token));

  if (!row) throw new HTTPException(404, { message: "Invite not found" });

  return {
    role: row.role,
    projectName: row.projectName,
    invitedByName: row.invitedByName,
    email: row.email,
    expired: row.expiresAt.getTime() < Date.now(),
    accepted: row.acceptedAt != null,
  };
}

/** The pool, or a transaction on it. */
type Executor = Pick<typeof db, "select">;

/**
 * Whether `email` holds an invite it could still accept: one that has not
 * expired and has not been accepted yet. Closed registration admits an invited
 * address on the strength of this — the invite someone with admin rights on a
 * project sent is the permission to hold an account here at all.
 *
 * Addresses are compared case-insensitively: an invite to `Ada@example.com` is
 * an invite to the person who registers as `ada@example.com`, since that is
 * how mail is delivered. The match is otherwise exact — no domain patterns, no
 * prefixes.
 */
export async function hasOpenInviteFor(
  email: string,
  executor: Executor = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        sql`lower(${invites.email}) = lower(${email.trim()})`,
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date())
      )
    )
    .limit(1);
  return row != null;
}

/**
 * Ownership is granted by an existing owner, never handed out by invite. An
 * omitted role is the project's default invite role.
 */
export const createInviteSchema = z.object({
  email: z.email(),
  role: z.enum(rawMemberRoleEnum).exclude(["owner"]).optional(),
});

export const inviteWithInviterSchema = inviteSchema.extend({
  invitedByName: z.string().nullable(),
});

/** Resolver for `authorizeProject`: `/invites/:id` and `/invites/:token/*`. */
export async function projectIdForInvite(
  idOrToken: string
): Promise<ProjectResolution> {
  const numeric = Number(idOrToken);
  const [row] = await db
    .select({ projectId: invites.projectId })
    .from(invites)
    .where(
      Number.isInteger(numeric)
        ? eq(invites.id, numeric)
        : eq(invites.token, idOrToken)
    );
  return row ? row.projectId : null;
}

export async function listInvites(projectId: number) {
  return db
    .select({ ...getTableColumns(invites), invitedByName: users.name })
    .from(invites)
    .leftJoin(users, eq(invites.invitedBy, users.id))
    .where(and(eq(invites.projectId, projectId), isNull(invites.acceptedAt)));
}

/** The link an invite's own page (`/invite/:token` in the client) reads its token from. */
const inviteUrl = (token: string): string =>
  new URL(`/invite/${token}`, betterAuthUrl).href;

/**
 * Invites `email` into a project, or re-issues the open invite it already
 * holds. The project says who may invite at all (403 `forbidden` below that
 * role), the role an invite grants when `role` is left out, and how long it
 * lives; the role granted is still capped at the inviter's own.
 */
export async function createInvite(
  projectId: number,
  inviter: { id: string; name: string; role: MemberRole },
  email: string,
  requestedRole?: AssignableRole
) {
  const { sharing } = await projectPolicy(projectId);
  if (!roleSatisfies(inviter.role, sharing.whoMayInvite)) {
    throw new ApiError(403, {
      code: "forbidden",
      message: "This project does not let your role invite people",
    });
  }

  const role = requestedRole ?? sharing.inviteRole;
  assertMayGrant(inviter.role, role);
  const lifetimeMs = sharing.inviteDays * DAY_MS;

  const normalisedEmail = email.trim().toLowerCase();

  const existingMember = await db
    .select({ id: members.id })
    .from(members)
    .leftJoin(users, eq(members.userId, users.id))
    .where(
      and(eq(members.projectId, projectId), eq(users.email, normalisedEmail))
    );
  if (existingMember.length > 0) {
    throw new HTTPException(409, {
      message: "That person is already a member of this project",
    });
  }

  const [invite] = await db
    .insert(invites)
    .values({
      projectId,
      invitedBy: inviter.id,
      email: normalisedEmail,
      role,
      token: randomBytes(24).toString("base64url"),
      expiresAt: new Date(Date.now() + lifetimeMs),
    })
    .onConflictDoUpdate({
      target: [invites.projectId, invites.email],
      targetWhere: isNull(invites.acceptedAt),
      set: {
        role,
        invitedBy: inviter.id,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + lifetimeMs),
      },
    })
    .returning();

  if (!invite) {
    throw new HTTPException(500, { message: "Failed to create invite" });
  }

  // Mail is a courtesy on top of the link, which the invites list still
  // shows and can still be copied by hand — a mail failure does not fail the
  // invite itself.
  if (emailEnabled) {
    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (project) {
      const { "instance-branding.name": instanceName } = await instanceValues([
        "instance-branding.name",
      ]);
      await sendMail({
        to: invite.email,
        ...inviteEmail(
          project.name,
          inviter.name,
          role,
          inviteUrl(invite.token),
          instanceName
        ),
      });
    }
  }

  return invite;
}

export async function deleteInvite(id: number) {
  const [removed] = await db
    .delete(invites)
    .where(eq(invites.id, id))
    .returning();
  if (!removed) throw new HTTPException(404, { message: "Invite not found" });
  return removed;
}

/**
 * Redeems an invite for the signed-in user, once. The token is the capability
 * and the invite's address is the account it is for: after the state checks
 * (404, 409, 410) the user's email must equal it, ignoring case, or the answer
 * is a 403 `invite_email_mismatch` before anything is written.
 *
 * The row is locked for the whole transaction, so the checks and the writes
 * see the same state: a second concurrent accept blocks, re-reads the invite
 * as taken, and gets a 409.
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string }
) {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token, token))
      .for("update");

    if (!invite) throw new HTTPException(404, { message: "Invite not found" });
    if (invite.acceptedAt) {
      throw new HTTPException(409, { message: "Invite already accepted" });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new HTTPException(410, { message: "Invite has expired" });
    }
    if (invite.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new ApiError(403, {
        code: "invite_email_mismatch",
        message: "This invite was sent to a different email address",
      });
    }

    await tx
      .insert(members)
      .values({
        projectId: invite.projectId,
        userId: user.id,
        role: invite.role,
      })
      .onConflictDoUpdate({
        target: [members.userId, members.projectId],
        set: { role: invite.role },
      });

    const [accepted] = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(eq(invites.id, invite.id))
      .returning();

    return accepted!;
  });
}
