"use client";

import { columnLabel } from "@/components/tables/column-label";
import { entityTable } from "@/entities/tables";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { useHub } from "../../hub-rows";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";
import { emptyTableCtx } from "./table-empty-ctx";
import { tableKindOf } from "./table-kind";

/** `tables.<kind>Sort`'s stored value: `<id>.asc` / `<id>.desc`, or "" for none. */
function parse(value: string): { id: string; desc: boolean } | null {
  if (!value) return null;
  const [id, dir] = value.split(".");
  return id ? { id, desc: dir === "desc" } : null;
}

/**
 * `tables.<kind>Sort`: pick one built-in column to sort the kind's table by
 * default, or None, and which direction. A single column only — the setting
 * holds one `<id>.<asc|desc>` pair, not a comma-joined multi-sort list.
 */
export function TableSortControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const { projectId } = useHub();
  const kind = tableKindOf(definition.key, "Sort");
  const ctx = useMemo(() => emptyTableCtx(kind, projectId), [kind, projectId]);
  const parts = entityTable(kind).useParts(ctx);
  const stored = parse(typeof value === "string" ? value : "");

  const options = useMemo(
    () =>
      parts.columns
        // As the toolbar's own sort menu: a column the table cannot sort by
        // is one the server's sort whitelist would drop.
        .filter((column) => column.id && column.enableSorting !== false)
        .map((column) => ({
          id: column.id as string,
          label: columnLabel({ id: column.id as string, columnDef: column }),
        })),
    [parts.columns]
  );

  const activeLabel = options.find((o) => o.id === stored?.id)?.label;

  return (
    <div
      id={id}
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex items-center gap-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            <IconArrowsSort className="h-4 w-4" />
            {activeLabel ? `Sorted by ${activeLabel}` : "None"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onChange("")}>None</DropdownMenuItem>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onClick={() =>
                onChange(`${option.id}.${stored?.desc ? "desc" : "asc"}`)
              }
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {stored && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={stored.desc ? "Descending" : "Ascending"}
          onClick={() =>
            onChange(`${stored.id}.${stored.desc ? "asc" : "desc"}`)
          }
        >
          {stored.desc ? (
            <IconArrowDown className="h-4 w-4" />
          ) : (
            <IconArrowUp className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
