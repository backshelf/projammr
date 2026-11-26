import type { BulkSelection } from "@/entities/api";
import { toastActionResult } from "@/lib/action-toast";
import { toast } from "sonner";

import type { TableAction } from "./generic-table-types";
import type { DeclaredActionItem } from "./RowActions";

/**
 * Binds the declared actions a target is offered, those that at least one of
 * its loaded `rows` passes, to `onRun`. Every surface uses it, so the row
 * menus and the bulk bar never disagree about what a target can do.
 */
export function offeredActions<TData>(
  actions: TableAction<TData>[] | undefined,
  rows: TData[],
  onRun: (action: TableAction<TData>) => Promise<void>
): DeclaredActionItem[] | undefined {
  return actions
    ?.filter((action) => rows.some((row) => action.offered(row)))
    .map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      onSelect: () => onRun(action),
    }));
}

/**
 * Runs a declared action on the whole `selection` and toasts what it reports,
 * its Undo on offer for `undoWindowMs`. A `run` that throws toasts "Could not
 * {label} {noun}". Resolves whether the action succeeded, so the caller can
 * clear its selection.
 */
export async function runTableAction<TData>(
  action: TableAction<TData>,
  selection: BulkSelection,
  noun: string,
  undoWindowMs: number
): Promise<boolean> {
  let result;
  try {
    result = await action.run(selection);
  } catch {
    toast.error(`Could not ${action.label.toLowerCase()} ${noun}`);
    return false;
  }
  toastActionResult(result, undoWindowMs);
  return result.ok;
}
