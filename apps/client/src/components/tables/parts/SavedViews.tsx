"use client";

import type { RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { useDataTable } from "../data-table-context";
import { SavedViewsMenu } from "../toolbar-menus";

/**
 * The toolbar's saved-views picker. A table without a `savedViews` config, or
 * one that does not own the URL (a view is a URL query), renders nothing.
 */
export function SavedViews<TData extends RowData, TChild = never>(): ReactNode {
  const { urlState, ownsUrl, savedViews } = useDataTable<TData, TChild>();

  if (!ownsUrl || !savedViews) return null;

  return (
    <SavedViewsMenu
      views={savedViews.views}
      me={savedViews.me}
      onApply={(query) => urlState.applyViewQuery(query)}
      onSave={(name) => savedViews.onSave(name, urlState.viewQuery())}
      onDelete={savedViews.onDelete}
      onShare={savedViews.onShare}
      defaultViewId={savedViews.defaultViewId}
      onSetDefault={savedViews.onSetDefault}
      onClearDefault={savedViews.onClearDefault}
    />
  );
}
