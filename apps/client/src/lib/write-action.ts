import "server-only";

import { isActionError } from "@workspace/api/lib/action-result";
import type { ActionError } from "@workspace/api/api";
import { refresh } from "next/cache";

/**
 * Wraps the result of a server action that wrote something. On success the
 * current route is re-rendered in the action's own response, so no caller
 * refreshes after it. Only for functions that are never called during a render.
 */
export async function written<T>(
  result: Promise<T | ActionError>
): Promise<T | ActionError> {
  const value = await result;
  if (!isActionError(value)) refresh();
  return value;
}
