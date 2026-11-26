"use client";

import {
  IconAdjustmentsHorizontal,
  IconBookmark,
  IconChevronDown,
  IconChevronUp,
  IconLayoutList,
  IconStarFilled,
} from "@tabler/icons-react";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import type { SavedView } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

import { SavedViewRowExtras } from "./SavedViewRowExtras";
import { SaveViewForm } from "./SaveViewForm";

export type ColumnControl = {
  id: string;
  label: string;
  /** The heading the column is listed under; none for the table's own. */
  group?: string;
  isVisible: boolean;
  toggleVisibility: (visible: boolean) => void;
};

/**
 * `columns`, which list each group's together, as the runs the menu draws: the
 * ungrouped columns under no heading, then one run per group under its name.
 */
function columnSections(columns: readonly ColumnControl[]) {
  const sections: { group?: string; columns: ColumnControl[] }[] = [];
  for (const column of columns) {
    const last = sections.at(-1);
    if (last && last.group === column.group) last.columns.push(column);
    else sections.push({ group: column.group, columns: [column] });
  }
  return sections;
}

/**
 * Toolbar popover for column layout: show/hide each hideable column, nudge a
 * column left or right in the order, and reset all widths to their defaults.
 * A grouped column (a custom field) is listed under its group's heading and
 * moves among its group only. Every change is written straight to table
 * state, which mirrors into the URL.
 */
export function ColumnSettingsMenu({
  columns,
  onMove,
  onResetWidths,
}: {
  columns: ColumnControl[];
  onMove: (id: string, delta: number) => void;
  onResetWidths: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <IconAdjustmentsHorizontal className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-small font-medium">Columns</span>
          <Button variant="ghost" size="sm" onClick={onResetWidths}>
            Reset widths
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {columnSections(columns).map((section) => (
            <div
              key={section.group ?? ""}
              role="group"
              aria-label={section.group}
              className="space-y-0.5 not-first:mt-2 not-first:border-t not-first:border-rule not-first:pt-2"
            >
              {section.group && (
                <div className="px-1 pb-0.5 text-micro text-ink-soft">
                  {section.group}
                </div>
              )}
              {section.columns.map((column, index) => (
                <div
                  key={column.id}
                  className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ink/4"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-small">
                    <input
                      type="checkbox"
                      checked={column.isVisible}
                      onChange={(e) =>
                        column.toggleVisibility(e.target.checked)
                      }
                    />
                    <span className="truncate">{column.label}</span>
                  </label>
                  <button
                    aria-label={`Move ${column.label} up`}
                    disabled={index === 0}
                    className="text-ink-soft hover:text-ink disabled:opacity-30"
                    onClick={() => onMove(column.id, -1)}
                  >
                    <IconChevronUp size={14} />
                  </button>
                  <button
                    aria-label={`Move ${column.label} down`}
                    disabled={index === section.columns.length - 1}
                    className="text-ink-soft hover:text-ink disabled:opacity-30"
                    onClick={() => onMove(column.id, 1)}
                  >
                    <IconChevronDown size={14} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Toolbar "Group by" dropdown: pick one column, or "None". */
export function GroupByMenu({
  options,
  active,
  onChange,
}: {
  options: { id: string; label: string }[];
  active: string | null;
  onChange: (id: string | null) => void;
}) {
  const activeLabel = options.find((o) => o.id === active)?.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <IconLayoutList className="h-4 w-4" />
          {activeLabel ? `Grouped by ${activeLabel}` : "Group by"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          disabled={active == null}
          onClick={() => onChange(null)}
        >
          None
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={active === o.id}
            onCheckedChange={(checked) => onChange(checked ? o.id : null)}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Toolbar saved-views picker: apply a named view (its query string replaces the
 * current one), save the current view under a name, share or unshare an own
 * view, delete one, or set/clear it as this project and kind's default. A view
 * that is not the caller's own shows a shared mark with the owner's name; the
 * default carries a filled star; `savedViewActions` decides which of the
 * write actions the row's trailing menu offers, the same rule the phone sheet
 * applies. Setting or clearing the default is not gated by that rule: it is a
 * personal setting, not a change to the view itself.
 */
export function SavedViewsMenu({
  views,
  me,
  onApply,
  onSave,
  onDelete,
  onShare,
  defaultViewId,
  onSetDefault,
  onClearDefault,
}: {
  views: SavedView[];
  me: string;
  onApply: (query: string) => void;
  onSave: (name: string) => Promise<boolean>;
  onDelete: (viewId: number) => Promise<boolean>;
  onShare: (viewId: number, shared: boolean) => Promise<boolean>;
  defaultViewId: number | null;
  onSetDefault: (viewId: number) => Promise<boolean>;
  onClearDefault: (viewId: number) => Promise<boolean>;
}) {
  const deletion = useDeleteGate<SavedView>("savedView", (view) =>
    onDelete(view.id)
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <IconBookmark className="h-4 w-4" />
          Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="mb-1 px-1 text-small font-medium">Saved views</div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {views.length === 0 && (
            <p className="px-1 py-1 text-small text-ink-soft">
              No saved views yet.
            </p>
          )}
          {views.map((view) => (
            <div
              key={view.id}
              className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ink/4"
            >
              {view.id === defaultViewId && (
                <span title="Default view" className="shrink-0 text-art">
                  <IconStarFilled aria-hidden size={14} />
                  <span className="sr-only">Default view</span>
                </span>
              )}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-small"
                onClick={() => onApply(view.config.query)}
              >
                {view.name}
              </button>
              <SavedViewRowExtras
                view={view}
                me={me}
                iconSize={14}
                onShare={onShare}
                onRequestDelete={deletion.request}
                isDefault={view.id === defaultViewId}
                onSetDefault={onSetDefault}
                onClearDefault={onClearDefault}
              />
            </div>
          ))}
        </div>
        <SaveViewForm onSave={onSave} className="mt-2" />
      </PopoverContent>
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete "${deletion.pending?.name}"?`}
      />
    </Popover>
  );
}
