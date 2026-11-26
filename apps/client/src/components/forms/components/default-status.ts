import type { ActionError, Status } from "@workspace/api/api";
import { use } from "react";

import { useSetting } from "@/lib/settings/provider";

import { unwrapStatuses } from "./field-resolver";

/**
 * A default status id as a status field's raw draft: the id when the project
 * still has that status, blank when it was deleted, so the create starts empty
 * and the server's own skip of a stale default applies.
 */
export function defaultStatusRaw(
  statusId: number,
  statuses: readonly Pick<Status, "id">[]
): string {
  return statuses.some((s) => s.id === statusId) ? String(statusId) : "";
}

/**
 * A new form's starting status: the project's default for `key`, filtered
 * against the statuses the form offers. Suspends until they load.
 */
export function useDefaultStatusRaw(
  key: "project-defaults.trackStatusId" | "project-defaults.collectionStatusId",
  statusesProm: Promise<Status[] | ActionError>
): string {
  const statusId = useSetting(key);
  return defaultStatusRaw(statusId, unwrapStatuses(use(statusesProm)));
}
