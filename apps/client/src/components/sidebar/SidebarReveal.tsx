"use client";

import { SidebarTrigger, useSidebar } from "@workspace/ui/components/sidebar";

/**
 * The way back to a closed sidebar. The trigger lives in the sidebar's own
 * footer while it is open; once it closes, that control goes with it, so this
 * renders the only remaining one in the player bar.
 *
 * The player bar and the sidebar are both desktop-only chrome — a phone
 * navigates from the tab bar instead — so this only has the collapsed state to
 * answer for.
 */
export function SidebarReveal() {
  const { state } = useSidebar();

  if (state === "expanded") return null;

  return (
    <SidebarTrigger
      className={"shrink-0 text-ink-soft hover:text-ink"}
      aria-label={"Show sidebar"}
    />
  );
}
