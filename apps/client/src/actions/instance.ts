"use server";

import { serverApi } from "@/lib/server-api";
import type { ActionError, Instance } from "@workspace/api/api";
import { toActionResult } from "@workspace/api/lib/action-result";

/** Public facts about this instance: registration, whether anyone has
 *  claimed it yet, and whether it can send mail. No session required. */
export async function getInstance(): Promise<Instance | ActionError> {
  const res = await serverApi.GET("/api/instance");

  return toActionResult(res, "Failed to read the instance");
}
