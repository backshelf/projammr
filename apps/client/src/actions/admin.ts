"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import type {
  AdminResetLink,
  AdminStorage,
  ActionError,
  InstanceMachinesPage,
  InstanceUser,
  InstanceUserPatch,
  InstanceUsersPage,
} from "@workspace/api/api";
import { toActionResult } from "@workspace/api/lib/action-result";

export async function getAdminUsers(
  page: number,
  pageSize: number
): Promise<InstanceUsersPage | ActionError> {
  const res = await serverApi.GET("/api/admin/users", {
    params: { query: { page, pageSize } },
  });

  return toActionResult(res, "Failed to read the instance's accounts");
}

export async function getAdminMachines(
  page: number,
  pageSize: number
): Promise<InstanceMachinesPage | ActionError> {
  const res = await serverApi.GET("/api/admin/machines", {
    params: { query: { page, pageSize } },
  });

  return toActionResult(res, "Failed to read the instance's machines");
}

export async function updateInstanceUser(
  userId: string,
  patch: InstanceUserPatch
): Promise<InstanceUser | ActionError> {
  const res = await serverApi.PATCH("/api/admin/users/{id}", {
    params: { path: { id: userId } },
    body: patch,
  });

  return written(toActionResult(res, "Failed to update the account"));
}

export async function createResetLink(
  userId: string
): Promise<AdminResetLink | ActionError> {
  const res = await serverApi.POST("/api/admin/users/{id}/reset-link", {
    params: { path: { id: userId } },
  });

  return written(toActionResult(res, "Failed to create a reset link"));
}

export async function getAdminStorage(): Promise<AdminStorage | ActionError> {
  const res = await serverApi.GET("/api/admin/storage");

  return toActionResult(res, "Failed to read the instance's storage");
}
