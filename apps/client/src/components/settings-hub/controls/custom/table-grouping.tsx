"use client";

import { entityTable } from "@/entities/tables";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconLayoutList } from "@tabler/icons-react";
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

/**
 * `tables.<kind>Grouping`: which built-in column the kind's table groups by
 * default, or None, mirroring the toolbar's own "Group by" menu.
 */
export function TableGroupingControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const { projectId } = useHub();
  const kind = tableKindOf(definition.key, "Grouping");
  const ctx = useMemo(() => emptyTableCtx(kind, projectId), [kind, projectId]);
  const parts = entityTable(kind).useParts(ctx);
  const options = parts.groupByOptions ?? [];
  const active = typeof value === "string" && value ? value : null;
  const activeLabel = options.find((o) => o.id === active)?.label;

  return (
    <div
      id={id}
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            <IconLayoutList className="h-4 w-4" />
            {activeLabel ? `Grouped by ${activeLabel}` : "Group by"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            disabled={active == null}
            onClick={() => onChange("")}
          >
            None
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={active === option.id}
              onCheckedChange={(checked) => onChange(checked ? option.id : "")}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
