/** Which of a kind's rows a list page lists: its live rows, or its archived ones. */
export type ListScope = "live" | "archived";

/** What a list page renders under its head. */
export type ListBody = "table" | "board" | "empty";

/**
 * An archived page shows its empty state only when the kind has nothing
 * archived at all; a search or filter that matches nothing keeps the table, so
 * its toolbar can clear it. Only a live page offers the board.
 */
export function listBody({
  scope,
  view,
  archivedCount,
}: {
  scope: ListScope;
  view: "list" | "board";
  archivedCount?: number;
}): ListBody {
  if (scope === "archived") return archivedCount === 0 ? "empty" : "table";
  return view === "board" ? "board" : "table";
}
