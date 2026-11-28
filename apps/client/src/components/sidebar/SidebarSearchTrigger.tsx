"use client";

import { useCommandPalette } from "@/components/command-palette/command-palette-context";
import { IconSearch } from "@tabler/icons-react";
import { SidebarMenuButton } from "@workspace/ui/components/sidebar";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";

/**
 * A button styled to look like a quiet field, not a real input — a second live
 * search field would mean two sources of truth for the query, and the palette
 * would have to sync back to a control it doesn't own. This just opens the
 * palette; the palette's own input takes over from there.
 */
export function SidebarSearchTrigger() {
  const { setOpen } = useCommandPalette();
  const hint = useIsApplePlatform() ? "⌘K" : "Ctrl K";

  return (
    <SidebarMenuButton
      size={"sm"}
      onClick={() => setOpen(true)}
      className={
        "justify-between gap-2 border border-rule bg-paper/50 text-ink-soft hover:border-rule-strong hover:bg-sidebar-accent hover:text-ink dark:bg-paper/25"
      }
    >
      <span className={"flex min-w-0 items-center gap-2"}>
        <IconSearch
          className={"size-3.5 shrink-0 text-ink-faint"}
          aria-hidden
        />
        <span className={"truncate"}>Search</span>
      </span>
      <kbd className={"shrink-0 font-sub text-micro text-ink-faint"}>
        {hint}
      </kbd>
    </SidebarMenuButton>
  );
}
