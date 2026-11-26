"use client";

import type { SavedViewsConfig } from "@/components/tables/generic-table-types";
import {
  clearDefaultSavedView,
  defaultSavedViewId,
  setDefaultSavedView,
} from "@/lib/default-saved-view";
import {
  createSavedView,
  deleteSavedView,
  updateSavedView,
} from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useSetting, useUserSettingsWrite } from "@/lib/settings/provider";
import type { SavedView, SavedViewKind } from "@workspace/api/api";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { isActionError } from "@workspace/api/lib/action-result";

const NO_VIEWS: SavedView[] = [];

/**
 * Builds the {@link SavedViewsConfig} a table's toolbar picker needs: the
 * current list plus save/delete/share handlers that hit the API and refresh
 * the RSC tree so the new list is server-rendered.
 *
 * `loaded` is `undefined` when the table holds no list of its own (an embedded
 * table, or a read that failed): the picker is empty, and a stored default is
 * never judged stale against a list nobody read.
 */
export function useSavedViews(
  projectId: number,
  kind: SavedViewKind,
  loaded: SavedView[] | undefined,
  me: string
): SavedViewsConfig {
  const views = loaded ?? NO_VIEWS;
  const mutate = useMutate();

  const onSave = useCallback(
    async (name: string, query: string) => {
      const result = await mutate(
        createSavedView(projectId, kind, name, query)
      );
      if (isActionError(result)) {
        toast.error(`Failed to save view: ${result.error}`);
        return false;
      }
      toast.success(`Saved view "${name}"`);
      return true;
    },
    [projectId, kind, mutate]
  );

  const onDelete = useCallback(
    async (viewId: number) => {
      const result = await mutate(deleteSavedView(projectId, viewId));
      if (isActionError(result)) {
        toast.error(`Failed to delete view: ${result.error}`);
        return false;
      }
      return true;
    },
    [projectId, mutate]
  );

  const onShare = useCallback(
    async (viewId: number, shared: boolean) => {
      const result = await mutate(
        updateSavedView(projectId, viewId, { shared })
      );
      if (isActionError(result)) {
        toast.error(`Failed to update view: ${result.error}`);
        return false;
      }
      return true;
    },
    [projectId, mutate]
  );

  const defaultSavedViews = useSetting("tables.defaultSavedView");
  const writeUserSettings = useUserSettingsWrite();
  const storedDefaultId = defaultSavedViewId(
    defaultSavedViews,
    projectId,
    kind
  );
  // A default that no longer names one of `views` is stale (its saved view
  // was deleted elsewhere); this is the one place that writes the clear, so
  // no other reader of the setting ever has to tell a stale id from a live one.
  const stale =
    loaded !== undefined &&
    storedDefaultId !== undefined &&
    !loaded.some((view) => view.id === storedDefaultId);

  useEffect(() => {
    if (!stale) return;
    void writeUserSettings({
      "tables.defaultSavedView": clearDefaultSavedView(
        defaultSavedViews,
        projectId,
        kind
      ),
    });
  }, [stale, defaultSavedViews, projectId, kind, writeUserSettings]);

  const defaultViewId = stale ? null : (storedDefaultId ?? null);

  const onSetDefault = useCallback(
    async (viewId: number) => {
      try {
        await writeUserSettings({
          "tables.defaultSavedView": setDefaultSavedView(
            defaultSavedViews,
            projectId,
            kind,
            viewId
          ),
        });
        return true;
      } catch {
        toast.error("Failed to set the default view");
        return false;
      }
    },
    [defaultSavedViews, projectId, kind, writeUserSettings]
  );

  const onClearDefault = useCallback(async () => {
    try {
      await writeUserSettings({
        "tables.defaultSavedView": clearDefaultSavedView(
          defaultSavedViews,
          projectId,
          kind
        ),
      });
      return true;
    } catch {
      toast.error("Failed to clear the default view");
      return false;
    }
  }, [defaultSavedViews, projectId, kind, writeUserSettings]);

  return useMemo(
    () => ({
      views,
      me,
      onSave,
      onDelete,
      onShare,
      defaultViewId,
      onSetDefault,
      onClearDefault,
    }),
    [
      views,
      me,
      onSave,
      onDelete,
      onShare,
      defaultViewId,
      onSetDefault,
      onClearDefault,
    ]
  );
}
