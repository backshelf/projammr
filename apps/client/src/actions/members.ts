"use server";

import { redirect } from "next/navigation";
import { setProjectCookie } from "@/actions/cookie";
import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  isActionError,
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  AssignableRole,
  InvitePreview,
  NewInvite,
  ProjectInvite,
  ProjectMember,
} from "@workspace/api/api";

const LAST_OWNER = { 409: "A project must keep at least one owner" };

export const getProjectMembers = async (
  projectId: number
): Promise<ProjectMember[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/members", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch members");
};

export const updateMemberRole = async (
  projectId: number,
  userId: string,
  role: AssignableRole
): Promise<ProjectMember | ActionError> => {
  const res = await serverApi.PATCH("/api/projects/{id}/members/{userId}", {
    params: { path: { id: String(projectId), userId } },
    body: { role },
  });

  return written(
    toActionResult(res, "Failed to update role", { messages: LAST_OWNER })
  );
};

export const removeMember = async (
  projectId: number,
  userId: string
): Promise<{ removed: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/projects/{id}/members/{userId}", {
    params: { path: { id: String(projectId), userId } },
  });

  return written(
    toActionOutcome(
      res,
      "Failed to remove member",
      {
        removed: true,
      } as const,
      { messages: LAST_OWNER }
    )
  );
};

/**
 * Drops the caller's own membership. The last owner has to transfer first.
 * On success it clears the project cookie and redirects home, and so never
 * returns: `written()`'s refresh, or the cookie write alone, would re-render
 * the route just left, which now answers not-found.
 */
export const leaveProject = async (projectId: number): Promise<ActionError> => {
  const res = await serverApi.POST("/api/projects/{id}/leave", {
    params: { path: { id: String(projectId) } },
  });

  const outcome = await toActionOutcome(
    res,
    "Failed to leave project",
    { left: true } as const,
    {
      messages: {
        409: "You're the only owner. Transfer ownership to another member before you leave.",
      },
    }
  );
  if (isActionError(outcome)) return outcome;
  await setProjectCookie(undefined);
  redirect("/");
};

/**
 * Hands the project to another member. The caller drops to admin, so every
 * owner-only affordance they had disappears with the same call.
 */
export const transferOwnership = async (
  projectId: number,
  userId: string
): Promise<ProjectMember | ActionError> => {
  const res = await serverApi.POST("/api/projects/{id}/transfer-ownership", {
    params: { path: { id: String(projectId) } },
    body: { userId },
  });

  return written(
    toActionResult(res, "Failed to transfer ownership", {
      messages: { 403: "Only the owner can transfer ownership" },
    })
  );
};

export const getProjectInvites = async (
  projectId: number
): Promise<ProjectInvite[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/invites", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch invites");
};

export const createInvite = async (
  projectId: number,
  invite: NewInvite
): Promise<ProjectInvite | ActionError> => {
  const res = await serverApi.POST("/api/projects/{id}/invites", {
    params: { path: { id: String(projectId) } },
    body: invite,
  });

  return written(
    toActionResult(res, "Failed to send invite", {
      messages: { 409: "That person is already a member" },
    })
  );
};

export const revokeInvite = async (
  inviteId: number
): Promise<{ revoked: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/invites/{id}", {
    params: { path: { id: String(inviteId) } },
  });

  return written(
    toActionOutcome(res, "Failed to revoke invite", {
      revoked: true,
    } as const)
  );
};

export const getInvitePreview = async (
  token: string
): Promise<InvitePreview | ActionError> => {
  const res = await serverApi.GET("/api/invites/{token}", {
    params: { path: { token } },
  });

  return toActionResult(res, "Failed to load invite", {
    messages: { 404: "This invite link is not valid" },
  });
};

export const acceptInvite = async (
  token: string
): Promise<{ projectId: number } | ActionError> => {
  const res = await serverApi.POST("/api/invites/{token}/accept", {
    params: { path: { token } },
  });

  const result = await toActionResult<{ projectId?: number }>(
    res,
    "Failed to accept invite",
    {
      messages: {
        403: "This invite was sent to a different email address",
        404: "This invite no longer exists",
        409: "This invite has already been accepted",
        410: "This invite has expired",
      },
    }
  );

  if (isActionError(result)) return result;
  if (result.projectId == null) return { error: "Failed to accept invite" };

  return { projectId: result.projectId };
};
