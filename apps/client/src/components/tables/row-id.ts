/** The entity id of a table row's data, whatever the row's type. */
export const rowIdOf = (row: unknown) => (row as { id?: number }).id;
