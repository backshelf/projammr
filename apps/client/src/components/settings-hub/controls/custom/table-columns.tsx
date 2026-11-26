"use client";

import { columnLabel } from "@/components/tables/column-label";
import { entityTable } from "@/entities/tables";
import { Switch } from "@workspace/ui/components/switch";
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
 * A partial record, column id → whether it shows; an id missing shows as the
 * list table shows it by default (hidden when it is one of the table's
 * `initiallyHiddenColumns`).
 */
type Visibility = Record<string, boolean>;

/**
 * `tables.<kind>Columns`: one switch per built-in column the kind's table
 * has, in the state the list table would show it. A toggle writes only the
 * columns that differ from the table's own default, so a column the record
 * never named keeps following it. Ungrouped columns come first, then each
 * group's, mirroring the toolbar's own column menu order.
 */
export function TableColumnsControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const { projectId } = useHub();
  const kind = tableKindOf(definition.key, "Columns");
  const ctx = useMemo(() => emptyTableCtx(kind, projectId), [kind, projectId]);
  const parts = entityTable(kind).useParts(ctx);
  const stored = (value ?? {}) as Visibility;

  const columns = useMemo(
    () =>
      parts.columns
        .filter((column) => column.enableHiding !== false && column.id)
        .map((column) => ({
          id: column.id as string,
          label: columnLabel({ id: column.id as string, columnDef: column }),
          group: column.meta?.group,
        }))
        .sort(
          (a, b) =>
            Number(a.group !== undefined) - Number(b.group !== undefined)
        ),
    [parts.columns]
  );

  const hiddenByDefault = useMemo(
    () => new Set(parts.initiallyHiddenColumns ?? []),
    [parts.initiallyHiddenColumns]
  );
  const shows = (columnId: string) =>
    stored[columnId] ?? !hiddenByDefault.has(columnId);

  const set = (columnId: string, visible: boolean) =>
    onChange(
      Object.fromEntries(
        columns
          .map(({ id }) => [id, id === columnId ? visible : shows(id)] as const)
          .filter(([id, shown]) => shown === hiddenByDefault.has(id))
      )
    );

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      {columns.map((column) => {
        const visible = shows(column.id);
        return (
          <span key={column.id} className="flex items-center gap-2">
            <Switch
              checked={visible}
              disabled={disabled}
              aria-label={column.label}
              onCheckedChange={(next) => set(column.id, next)}
            />
            <span className="text-small">{column.label}</span>
          </span>
        );
      })}
    </div>
  );
}
