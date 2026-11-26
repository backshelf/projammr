/** The slice of a TanStack leaf column a display name can be read from. */
export type LabelledColumn = { id: string; columnDef: { header?: unknown } };

/**
 * What to call a column in a list of them. A header that is plain text is the
 * name the user already reads at the top of that column; anything richer is a
 * rendered node with no name to take, so the column's id stands in.
 */
export function columnLabel(column: LabelledColumn): string {
  return typeof column.columnDef.header === "string" && column.columnDef.header
    ? column.columnDef.header
    : column.id;
}
