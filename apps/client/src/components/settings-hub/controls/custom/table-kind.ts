import type { TableEntityKind } from "@workspace/api/api";

/**
 * The table kind a `tables.<kind>Columns` / `tables.<kind>Sort` /
 * `tables.<kind>Grouping` setting's key names, stripping the `tables.` prefix
 * and the control's own suffix.
 */
export function tableKindOf(
  key: string,
  suffix: "Columns" | "Sort" | "Grouping"
): TableEntityKind {
  const kind = key.slice("tables.".length, key.length - suffix.length);
  return kind as TableEntityKind;
}
