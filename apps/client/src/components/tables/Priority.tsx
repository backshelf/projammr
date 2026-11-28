import type { PriorityLevel } from "@workspace/api/api";
import { StatusChip } from "@workspace/ui/components/status-chip";

import type { FilterColumnConfig } from "./generic-table-types";

/**
 * The priority filter every table kind offers: one option per level of the
 * project's scale, bottom level first, keyed by level id as the server's
 * `priority` param and its facet counts are. Several levels can be chosen at
 * once (`priority=3,7`), and the trigger names each in the scale's order.
 */
export function priorityFilterColumn(
  levels: readonly PriorityLevel[]
): FilterColumnConfig {
  return {
    id: "priority",
    label: "Priority",
    param: "priority",
    multiple: true,
    listed: true,
    options: levels.map((level) => ({
      value: String(level.id),
      label: level.name,
    })),
  };
}

/** Whether a priority level is the default "None" placeholder suppressed in table/card cells. */
export function isSuppressedPriority(
  level: Pick<PriorityLevel, "name"> | null | undefined
): boolean {
  return Boolean(level && level.name.trim().toLowerCase() === "none");
}

/**
 * A priority level, worn as the chip a status wears in a table: the level's
 * own colour as the quiet tint (18% fill, 35% border) with the label in the
 * ambient ink, so every colour a user picks reads on either theme. It is a
 * flag rather than a pipeline position, so it carries no pie. Every level
 * renders the same way by default; callers that suppress the default "None"
 * placeholder pass `hideDefault`.
 */
export function PriorityBadge({
  level,
  hideDefault = false,
  className,
}: {
  level: PriorityLevel;
  hideDefault?: boolean;
  className?: string;
}) {
  if (hideDefault && isSuppressedPriority(level)) return null;
  return (
    <StatusChip flag colour={level.colour} className={className}>
      {level.name}
    </StatusChip>
  );
}
