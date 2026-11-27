import { dockTabs, type TabContext } from "@/components/dock/tabs";
import type { DockTabId } from "@/lib/policies/shell";
import type { ComponentType } from "react";

/**
 * A phone `TabBar` long-press destination surfaced in the command palette so
 * touch visitors can both trigger it directly and discover the hold gesture.
 */
export type TabQuickJump = {
  id: DockTabId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Gesture hint shown in the palette's trailing shortcut slot. */
  hint: string;
  /** The palette command id that performs the same jump, if any. */
  commandId?: string;
};

const QUICK_JUMP_META: Partial<
  Record<DockTabId, { label: string; commandId?: string }>
> = {
  notes: { label: "New note", commandId: "new-note" },
};

/**
 * Resolves the active `TabBar` long-press shortcuts for the configured dock
 * tabs and current route context. Tabs without a `longPressHref` (or whose
 * shortcut returns `null` in this context) are omitted.
 */
export function tabQuickJumps(
  dockTabIds: readonly DockTabId[],
  context: TabContext
): TabQuickJump[] {
  const jumps: TabQuickJump[] = [];
  for (const tab of dockTabs(dockTabIds)) {
    if (tab.kind !== "link" || !tab.longPressHref) continue;
    const href = tab.longPressHref(context);
    if (href === null) continue;
    const meta = QUICK_JUMP_META[tab.id];
    jumps.push({
      id: tab.id,
      label: meta?.label ?? `${tab.label} shortcut`,
      href,
      icon: tab.icon,
      hint: `Hold ${tab.label}`,
      commandId: meta?.commandId,
    });
  }
  return jumps;
}
