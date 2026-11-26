"use client";

import { useCommandPalette } from "@/components/command-palette/command-palette-context";
import { IconSearch } from "@tabler/icons-react";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { SidebarMenuButton } from "@workspace/ui/components/sidebar";

/**
 * A button styled to look like an input, not a real one — a second live
 * search field would mean two sources of truth for the query, and the
 * palette would have to sync back to a control it doesn't own. This just
 * opens the palette; the palette's own input takes over from there.
 */
export function SidebarSearchTrigger() {
  const { setOpen } = useCommandPalette();
  const hint = useIsApplePlatform() ? "⌘K" : "Ctrl K";

  return (
    <SidebarMenuButton
      onClick={() => setOpen(true)}
      className={"flex items-center justify-between gap-2 text-ink-soft"}
    >
      <span className={"flex items-center gap-2"}>
        <IconSearch className={"size-4"} />
        Search
      </span>
      <span className={"font-sub text-micro text-ink-soft"}>{hint}</span>
    </SidebarMenuButton>
  );
}
