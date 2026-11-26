import { browserApi } from "@/lib/browser-api";
import {
  SettingsWriteError,
  type SettingsWriteTarget,
} from "@/lib/settings/write-queue";
import type {
  SettingsAuditEntry,
  SettingsExport,
  SettingsHubRead,
  SettingsImportReport,
  SettingsLocksPatch,
  WrittenSettings,
} from "@workspace/api/api";
import {
  isActionError,
  toActionResult,
  type ActionError,
} from "@workspace/api/lib/action-result";
import type { SettingKey } from "@workspace/settings";

const unreachable = (error: unknown): ActionError => ({
  error: error instanceof Error ? error.message : "Network error",
});

/**
 * The hub read from the browser, resolved with `projectId`'s layer when there
 * is one.
 */
export async function readSettingsHub(
  projectId: number | null
): Promise<SettingsHubRead | ActionError> {
  return browserApi
    .GET("/api/settings", {
      params: {
        query: projectId === null ? {} : { project: String(projectId) },
      },
    })
    .then(
      (result) =>
        toActionResult<SettingsHubRead>(result, "Couldn't read your settings"),
      unreachable
    );
}

/**
 * Sets (`true`) or lifts (`false`) locks at a project or the instance. A lock
 * is not a queued write: it goes out at once and settles with the hub's view
 * of the keys it named, or rejects with a `SettingsWriteError`.
 */
export async function lockSettings(
  { scope, id }: SettingsWriteTarget,
  locks: Partial<Record<SettingKey, boolean>>
): Promise<WrittenSettings> {
  const result = await browserApi
    .PUT("/api/settings/{scope}/{id}/locks", {
      params: { path: { scope, id: String(id) } },
      body: locks as SettingsLocksPatch,
    })
    .then(
      (answer) =>
        toActionResult<WrittenSettings>(answer, "Couldn't change the lock"),
      unreachable
    );
  if (isActionError(result)) {
    throw new SettingsWriteError(result, Object.keys(locks) as SettingKey[]);
  }
  return result;
}

/** The caller's own settings as a file an import takes back: the values they hold, not the effective ones. */
export async function exportSettings(
  userId: string
): Promise<SettingsExport | ActionError> {
  return browserApi
    .GET("/api/settings/user/{id}/export", {
      params: { path: { id: userId } },
    })
    .then(
      (result) =>
        toActionResult<SettingsExport>(result, "Couldn't export your settings"),
      unreachable
    );
}

/**
 * Hands a settings file to the import of the caller's own settings: as a dry
 * run, which reports what it would apply and skip and writes nothing, or for
 * real, which applies it in one transaction and reports the same. The file
 * goes as it was read; whether it is an export is the server's to say (a 400).
 */
export async function importSettings(
  userId: string,
  file: unknown,
  { dryRun }: { dryRun: boolean }
): Promise<SettingsImportReport | ActionError> {
  return browserApi
    .POST("/api/settings/user/{id}/import", {
      params: {
        path: { id: userId },
        query: dryRun ? { dryRun: "true" } : {},
      },
      body: file as SettingsExport,
    })
    .then(
      (result) =>
        toActionResult<SettingsImportReport>(
          result,
          "Couldn't import your settings"
        ),
      unreachable
    );
}

/** A scope whose settings changes are recorded, and the id that names it. */
export type AuditTarget = Extract<
  SettingsWriteTarget,
  { scope: "project" | "instance" }
>;

/**
 * One page of the recorded changes at a project or the instance, newest
 * first: the `limit` changes older than the one `before` names, or the latest.
 */
export async function readSettingsAudit(
  { scope, id }: AuditTarget,
  { limit, before }: { limit: number; before?: number }
): Promise<SettingsAuditEntry[] | ActionError> {
  return browserApi
    .GET("/api/settings/audit", {
      params: {
        query: {
          scope,
          id: String(id),
          limit,
          ...(before === undefined ? {} : { before }),
        },
      },
    })
    .then(
      (result) =>
        toActionResult<SettingsAuditEntry[]>(
          result,
          "Couldn't read the recent changes"
        ),
      unreachable
    );
}
