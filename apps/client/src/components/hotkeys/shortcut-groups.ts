import type { ListedCommand } from "@/components/commands/types";
import { GLOBAL_SCOPE } from "@workspace/ui/lib/keymap";

/**
 * Commands grouped under their headings in first-seen order, the global
 * scope's commands first and then each scope a surface pushes.
 */
export function groupByHeading<T extends { group: string; scope?: string }>(
  commands: readonly T[]
): [string, T[]][] {
  const global = (command: T) =>
    (command.scope ?? GLOBAL_SCOPE) === GLOBAL_SCOPE;
  const groups = new Map<string, T[]>();
  for (const command of [
    ...commands.filter(global),
    ...commands.filter((command) => !global(command)),
  ]) {
    const rows = groups.get(command.group) ?? [];
    rows.push(command);
    groups.set(command.group, rows);
  }
  return [...groups];
}

/** The commands with keys, grouped as {@link groupByHeading} does. */
export function shortcutGroups(
  commands: readonly ListedCommand[]
): [string, ListedCommand[]][] {
  return groupByHeading(commands.filter((command) => command.keys.length > 0));
}
