"use client";

import { SHEET_ROW } from "@/components/dock/BottomSheet";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconStarFilled,
} from "@tabler/icons-react";
import type { Facets, SavedView } from "@workspace/api/api";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

import {
  filterControl,
  filterSummary,
  memberValues,
  toggleMember,
} from "../filter-controls";
import type {
  ChoiceFilterConfig,
  FilterColumnConfig,
  SavedViewsConfig,
} from "../generic-table-types";
import { SaveViewForm } from "../SaveViewForm";
import { SavedViewRowExtras } from "../SavedViewRowExtras";
import type { ColumnFilterState } from "../use-table-url-state";
import { sortRowsFrom, type SortableColumn } from "./filter-sheet";

const SECTION_LABEL = cn(LABEL, "px-4 pt-4 pb-1 text-ink-soft");

/** A disclosure row's current value, shown collapsed beside its chevron. */
function ValueSummary({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto truncate pl-2 text-ink-soft">{children}</span>
  );
}

/** A row whose state is a tick — the shape both an option and a toggle take. */
function CheckRow({
  role,
  checked,
  onSelect,
  children,
  trailing,
  className,
}: {
  role: "radio" | "checkbox" | "switch";
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      className={cn(SHEET_ROW, "justify-between", className)}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
        <IconCheck
          className={cn("size-4 shrink-0 text-art", !checked && "opacity-0")}
        />
        <span className="truncate">{children}</span>
      </span>
      {trailing}
    </button>
  );
}

function RadioRow(
  props: Omit<Parameters<typeof CheckRow>[0], "role" | "className">
) {
  return <CheckRow role="radio" className="pl-8" {...props} />;
}

/**
 * A choice filter's options: a radio list for one value, a list of ticks for a
 * membership, each with its count unless the filter keeps none.
 */
function ChoiceOptions({
  config,
  value,
  counts,
  onChange,
}: {
  config: ChoiceFilterConfig;
  value: string | null;
  counts: Record<string, number>;
  onChange: (value: string | null) => void;
}) {
  const members = memberValues(value, config.multiple);
  return (
    <CollapsibleContent
      role={config.multiple ? "group" : "radiogroup"}
      aria-label={config.label}
    >
      <RadioRow checked={value == null} onSelect={() => onChange(null)}>
        Any
      </RadioRow>
      {config.options.map((option) => (
        <CheckRow
          key={option.value}
          role={config.multiple ? "checkbox" : "radio"}
          className="pl-8"
          checked={members.includes(option.value)}
          onSelect={() =>
            onChange(
              config.multiple ? toggleMember(value, option.value) : option.value
            )
          }
          trailing={
            config.counted === false ? undefined : (
              <span className="text-micro text-ink-soft tabular-nums">
                {counts[option.value] ?? 0}
              </span>
            )
          }
        >
          {option.label}
        </CheckRow>
      ))}
    </CollapsibleContent>
  );
}

/**
 * One filter as a disclosure row: its label and what it holds, opening onto
 * its options, or onto its form for a filter that is typed (a range, text).
 */
function FilterDisclosure({
  config,
  value,
  counts,
  onChange,
}: {
  config: FilterColumnConfig;
  value: string | null;
  counts: Record<string, number>;
  onChange: (value: string | null) => void;
}) {
  const control = filterControl(config);
  const Form = control.Form;
  return (
    <Collapsible>
      <CollapsibleTrigger className={cn(SHEET_ROW, "justify-between")}>
        <span className="truncate">{config.label}</span>
        <ValueSummary>{filterSummary(config, value) ?? "Any"}</ValueSummary>
        <CollapsibleChevron />
      </CollapsibleTrigger>
      {"options" in config ? (
        <ChoiceOptions
          config={config}
          value={value}
          counts={counts}
          onChange={onChange}
        />
      ) : (
        Form && (
          <CollapsibleContent className="px-4 pt-1 pb-3">
            <Form config={config} value={value} onChange={onChange} touch />
          </CollapsibleContent>
        )
      )}
    </Collapsible>
  );
}

export type FilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filterColumns?: FilterColumnConfig[];
  columnFilters: ColumnFilterState;
  facets?: Facets;
  onFilterChange: (param: string, value: string | null) => void;
  sortColumns: SortableColumn[];
  groupByOptions?: { id: string; label: string }[];
  activeGroupKey: string | null;
  onGroupChange: (id: string | null) => void;
  savedViews?: SavedViewsConfig;
  onApplyView: (query: string) => void;
  viewQuery: () => string;
  enableSelection?: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
};

/**
 * The phone replacement for the desktop toolbar's five separate menus: every
 * filter, the sort order, grouping, saved views and select mode in one bottom
 * sheet, opened from the toolbar's "Filter" button. Every control writes
 * through the same state the desktop menus use — there is no second copy of
 * filter, grouping or saved-view state for a phone to drift out of sync with.
 */
export function FilterSheet({
  open,
  onOpenChange,
  filterColumns,
  columnFilters,
  facets,
  onFilterChange,
  sortColumns,
  groupByOptions,
  activeGroupKey,
  onGroupChange,
  savedViews,
  onApplyView,
  viewQuery,
  enableSelection,
  selectMode,
  onToggleSelectMode,
}: FilterSheetProps) {
  const sortRows = sortRowsFrom(sortColumns);
  const deletion = useDeleteGate<SavedView>("savedView", (view) =>
    savedViews?.onDelete(view.id)
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85dvh] gap-0 rounded-t-lg p-0">
        <SheetHeader className="border-b border-rule px-4 py-3 pr-12">
          <SheetTitle className="text-small">Filter &amp; sort</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-4">
          {filterColumns && filterColumns.length > 0 && (
            <section>
              <h2 className={SECTION_LABEL}>Filters</h2>
              {filterColumns.map((fc) => (
                <FilterDisclosure
                  key={fc.param}
                  config={fc}
                  value={columnFilters[fc.param] ?? null}
                  counts={facets?.[fc.param] ?? {}}
                  onChange={(value) => onFilterChange(fc.param, value)}
                />
              ))}
            </section>
          )}

          {sortRows.length > 0 && (
            <section>
              <h2 className={SECTION_LABEL}>Sort</h2>
              {sortRows.map((row) => {
                const Icon =
                  row.direction === "asc"
                    ? IconArrowUp
                    : row.direction === "desc"
                      ? IconArrowDown
                      : null;
                const directionLabel =
                  row.direction === "asc"
                    ? "ascending"
                    : row.direction === "desc"
                      ? "descending"
                      : "not sorted";
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={cn(SHEET_ROW, "justify-between")}
                    aria-label={`Sort by ${row.label}, ${directionLabel}`}
                    onClick={row.toggle}
                  >
                    <span className="truncate">{row.label}</span>
                    {Icon ? (
                      <Icon className="size-4 shrink-0 text-art" />
                    ) : null}
                  </button>
                );
              })}
            </section>
          )}

          {groupByOptions && groupByOptions.length > 0 && (
            <section>
              <h2 className={SECTION_LABEL}>Group by</h2>
              <div role="radiogroup" aria-label="Group by">
                <RadioRow
                  checked={activeGroupKey == null}
                  onSelect={() => onGroupChange(null)}
                >
                  None
                </RadioRow>
                {groupByOptions.map((option) => (
                  <RadioRow
                    key={option.id}
                    checked={activeGroupKey === option.id}
                    onSelect={() => onGroupChange(option.id)}
                  >
                    {option.label}
                  </RadioRow>
                ))}
              </div>
            </section>
          )}

          {savedViews && (
            <section>
              <h2 className={SECTION_LABEL}>Views</h2>
              {savedViews.views.map((view) => (
                <div key={view.id} className={cn(SHEET_ROW, "gap-2")}>
                  {view.id === savedViews.defaultViewId && (
                    <span title="Default view" className="shrink-0 text-art">
                      <IconStarFilled aria-hidden size={16} />
                      <span className="sr-only">Default view</span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => {
                      onApplyView(view.config.query);
                      onOpenChange(false);
                    }}
                  >
                    {view.name}
                  </button>
                  <SavedViewRowExtras
                    view={view}
                    me={savedViews.me}
                    iconSize={16}
                    onShare={savedViews.onShare}
                    onRequestDelete={deletion.request}
                    isDefault={view.id === savedViews.defaultViewId}
                    onSetDefault={savedViews.onSetDefault}
                    onClearDefault={savedViews.onClearDefault}
                  />
                </div>
              ))}
              <Collapsible>
                <CollapsibleTrigger className={cn(SHEET_ROW, "text-art")}>
                  Save current view…
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-3">
                  <SaveViewForm
                    onSave={(name) => savedViews.onSave(name, viewQuery())}
                  />
                </CollapsibleContent>
              </Collapsible>
            </section>
          )}

          {enableSelection && (
            <section>
              <h2 className={SECTION_LABEL}>Select</h2>
              <CheckRow
                role="switch"
                checked={selectMode}
                onSelect={() => {
                  onToggleSelectMode();
                  onOpenChange(false);
                }}
              >
                Select rows
              </CheckRow>
            </section>
          )}
        </div>
      </SheetContent>
      {savedViews && (
        <ConfirmDeleteDialog
          {...deletion.dialog}
          title={`Delete "${deletion.pending?.name}"?`}
        />
      )}
    </Sheet>
  );
}
