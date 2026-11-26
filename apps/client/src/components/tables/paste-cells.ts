import { fieldKind } from "@/fields";
import type {
  FieldConfig,
  FieldKind,
  FieldKindName,
  FieldValue,
} from "@/fields/types";

type PlannedSave = {
  rowId: number;
  /**
   * The row field to write, which is the column id unless the kind renames it
   * with `saveAs`. Resolved here so paste writes the same field the cell
   * editor does; the two disagreeing is invisible until a kind has both
   * `saveAs` and `paste`.
   */
  field: string;
  value: FieldValue;
};

export type PastePlan = {
  saves: PlannedSave[];
  /** Cells whose column's kind rejected the pasted text; each is left unchanged. */
  skipped: number;
  /**
   * Cells landing on a navigable column that has no editable config at all —
   * the identity column is navigable so it can be selected and copied, but it
   * takes no paste. Counted apart from `skipped` because the reason is the
   * column rather than the text. A kind with `paste: false` is not counted:
   * a rectangle passing over it is that flag working as documented.
   */
  notEditable: number;
};

function lookupKind(name: FieldKindName): FieldKind | undefined {
  try {
    return fieldKind(name);
  } catch {
    return undefined;
  }
}

/**
 * Lays a pasted TSV grid over the table from `start` and decides, cell by
 * cell, what each save writes. Each cell's text goes through its column kind's
 * `parse`, so a paste accepts exactly what typing into that cell would.
 *
 * A cell is passed over without counting when it falls past the last row or
 * navigable column, its row has no id, its column has no config, its kind does
 * not resolve in the registry, or its kind takes no pasted text (`paste:
 * false`). A cell the kind's `parse` rejects (a blank into a `required` column
 * included) is counted in `skipped` and yields no save.
 *
 * `rowIds` lists the entity id of each row in display order, `undefined` for a
 * row that has none; `columnIds` lists the navigable columns in display order;
 * `start` indexes into both.
 */
export function planPaste({
  grid,
  columnIds,
  start,
  rowIds,
  configs,
}: {
  grid: string[][];
  columnIds: string[];
  start: { row: number; column: number };
  rowIds: (number | undefined)[];
  configs: Record<string, { type: FieldKindName } & FieldConfig>;
}): PastePlan {
  const kinds = new Map<string, FieldKind | undefined>();
  const saves: PlannedSave[] = [];
  let skipped = 0;
  let notEditable = 0;

  grid.forEach((cells, r) => {
    const rowId = rowIds[start.row + r];
    // `== null`, not `=== undefined`: the caller reads `id` off an untyped row
    // original, so a row without one can arrive as `null` as well as missing.
    if (rowId == null) return;
    cells.forEach((raw, c) => {
      const columnId = columnIds[start.column + c];
      if (columnId === undefined) return;
      const config = configs[columnId];
      if (!config) {
        notEditable += 1;
        return;
      }
      if (!kinds.has(columnId)) kinds.set(columnId, lookupKind(config.type));
      const kind = kinds.get(columnId);
      if (!kind?.paste) return;
      const parsed = kind.parse(raw, config);
      if (!parsed.ok) {
        skipped += 1;
        return;
      }
      saves.push({
        rowId,
        field: kind.saveAs ?? columnId,
        value: parsed.value,
      });
    });
  });

  return { saves, skipped, notEditable };
}
