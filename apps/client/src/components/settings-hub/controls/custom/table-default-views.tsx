"use client";

import { browserApi } from "@/lib/browser-api";
import {
  clearDefaultSavedView,
  defaultSavedViewId,
} from "@/lib/default-saved-view";
import type { SavedView, SavedViewKind } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { useEffect, useState } from "react";
import { useHub } from "../../hub-rows";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";
import type { DefaultSavedViewMap } from "@/lib/default-saved-view";

const KINDS: { id: SavedViewKind; label: string }[] = [
  { id: "track", label: "Tracks" },
  { id: "collection", label: "Collections" },
  { id: "session", label: "Sessions" },
];

/**
 * Each kind's saved views for `projectId`, refetched whenever it changes.
 * A browser fetch, not the `getSavedViews` server action: this control is a
 * client component, and a hub row has no server-rendered saved-views prop to
 * seed it with the way a table page does.
 */
function useProjectSavedViews(
  projectId: number | null
): Partial<Record<SavedViewKind, SavedView[]>> {
  const [found, setFound] = useState<{
    projectId: number | null;
    views: Partial<Record<SavedViewKind, SavedView[]>>;
  }>({ projectId: null, views: {} });

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    void Promise.all(
      KINDS.map(({ id }) =>
        browserApi.GET("/api/projects/{id}/saved-views", {
          params: { path: { id: String(projectId) }, query: { kind: id } },
        })
      )
    ).then((results) => {
      if (!current) return;
      const views: Partial<Record<SavedViewKind, SavedView[]>> = {};
      results.forEach(({ data }, i) => {
        if (data) views[KINDS[i]!.id] = data;
      });
      setFound({ projectId, views });
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  return found.projectId === projectId ? found.views : {};
}

/**
 * `tables.defaultSavedView`: which saved view each table kind opens on by
 * default in the current project, by name, with a Clear per kind. Show and
 * clear only — a default is set from a table's Views menu, not here. On a
 * hub page with no project, there is nothing to show.
 */
export function TableDefaultViewsControl({
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const { projectId } = useHub();
  const map = (value ?? {}) as DefaultSavedViewMap;
  const savedViews = useProjectSavedViews(projectId);

  if (projectId === null) {
    return (
      <p
        id={id}
        aria-labelledby={labelIdOf(id)}
        aria-describedby={describedByOf(id)}
        className="text-small text-ink-soft"
      >
        Open a project's settings to see its defaults.
      </p>
    );
  }

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      {KINDS.map(({ id: kind, label }) => {
        const viewId = defaultSavedViewId(map, projectId, kind);
        const name = viewId
          ? (savedViews[kind]?.find((view) => view.id === viewId)?.name ??
            "None")
          : "None";
        return (
          <span key={kind} className="flex items-center justify-between gap-2">
            <span className="text-small">
              {label}: <span className="text-ink-soft">{name}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !viewId}
              aria-label={`Clear the default ${label.toLowerCase()} view`}
              onClick={() =>
                onChange(clearDefaultSavedView(map, projectId, kind))
              }
            >
              Clear
            </Button>
          </span>
        );
      })}
    </div>
  );
}
