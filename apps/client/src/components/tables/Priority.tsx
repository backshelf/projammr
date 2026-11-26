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

/**
 * A priority level, worn as the chip a status wears in a table: the level's
 * own colour as the quiet tint (18% fill, 35% border) with the label in the
 * ambient ink, so every colour a user picks reads on either theme. It is a
 * flag rather than a pipeline position, so it carries no pie. Every level
 * renders the same way, the default one included; where a level sits on the
 * scale is the menus' order, not the chip's.
 */
export function PriorityBadge({
  level,
  className,
}: {
  level: PriorityLevel;
  className?: string;
}) {
  return (
    <StatusChip flag colour={level.colour} className={className}>
      {level.name}
    </StatusChip>
  );
}
