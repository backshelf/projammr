import "server-only";
import { attempt } from "@/lib/attempt";
import { serverApi } from "@/lib/server-api";
import { cachedInstance } from "@/lib/server-data";
import { getCachedSession, isSignedOut } from "@/lib/session";
import type {
  EffectiveSettingsRead,
  SettingsHubRead,
} from "@workspace/api/api";
import {
  isActionError,
  toActionResult,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { cache } from "react";
import {
  DEFAULT_EFFECTIVE_SETTINGS,
  effectiveSettings,
  type EffectiveSettings,
} from "./effective";

/**
 * A signed-out read's version. The instance's public settings carry none of
 * their own, so it is the values themselves: a read of changed values is a new
 * version, which a mounted provider takes.
 */
const publicVersion = (values: unknown) => `public:${JSON.stringify(values)}`;

/** A page renders from the registry defaults rather than fail on its settings. */
function fallback(failure: ActionError): EffectiveSettings {
  console.warn(
    `Settings: ${failure.error}; rendering from the registry defaults.`
  );
  return DEFAULT_EFFECTIVE_SETTINGS;
}

/** Signed out: the instance's public settings, which `GET /api/instance` carries. */
async function publicSettings(): Promise<EffectiveSettings> {
  const instance = await attempt(cachedInstance);
  return isActionError(instance)
    ? fallback(instance)
    : effectiveSettings(instance.settings, publicVersion(instance.settings));
}

const read = cache(
  async (projectId: number | null): Promise<EffectiveSettings> => {
    if (isSignedOut(await getCachedSession())) return publicSettings();

    const result = await attempt(async () =>
      toActionResult<EffectiveSettingsRead>(
        await serverApi.GET("/api/settings/effective", {
          params: {
            query: projectId === null ? {} : { project: String(projectId) },
          },
        }),
        "Couldn't read your settings"
      )
    );
    return isActionError(result)
      ? fallback(result)
      : effectiveSettings(result.values, result.version);
  }
);

/**
 * The caller's effective settings for this request, resolved with
 * `projectId`'s layer when given; one read per request for each project. A
 * signed-out visitor, or a guest, gets the instance's public settings and no
 * authenticated read is tried. A read that fails renders the page from the
 * registry defaults with a console warning rather than an error page.
 */
export const cachedEffectiveSettings = (projectId?: number) =>
  read(projectId ?? null);

const hubRead = cache(
  async (projectId: number | null): Promise<SettingsHubRead | ActionError> =>
    attempt(async () =>
      toActionResult<SettingsHubRead>(
        await serverApi.GET("/api/settings", {
          params: {
            query: projectId === null ? {} : { project: String(projectId) },
          },
        }),
        "Couldn't read your settings"
      )
    )
);

/**
 * The settings hub's read for this request: every setting the caller
 * receives with its source, lock, writability and what each scope holds,
 * resolved with `projectId`'s layer when given. Unlike the effective read it
 * has no fallback: a failure comes back for the page to show, and a project
 * the caller does not belong to is a 404.
 */
export const cachedSettingsHub = (projectId?: number) =>
  hubRead(projectId ?? null);
