"use client";

import { browserApi } from "@/lib/browser-api";
import type { EffectiveSettingsRead } from "@workspace/api/api";
import type { ActionError } from "@workspace/api/lib/action-result";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { effectiveSettings, type EffectiveSettings } from "./effective";

/**
 * The caller's effective settings from the browser: `projectId`'s layer over
 * theirs, or theirs alone for `null`. The same read the server makes for a
 * page, answered by the same endpoint.
 */
export async function readEffectiveSettings(
  projectId: number | null
): Promise<EffectiveSettings | ActionError> {
  const result = await toActionResult<EffectiveSettingsRead>(
    await browserApi.GET("/api/settings/effective", {
      params: {
        query: projectId === null ? {} : { project: String(projectId) },
      },
    }),
    "Couldn't read your settings"
  );
  return isActionError(result)
    ? result
    : effectiveSettings(result.values, result.version);
}
