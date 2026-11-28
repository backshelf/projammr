"use client";

import { TabBar } from "@/components/dock/TabBar";
import { CurrentProjectProvider } from "@/components/dock/CurrentProjectProvider";
import { MiniPlayer } from "@/components/music-player/MiniPlayer";
import { useCurrentTrack } from "@/components/music-player/player-hooks";
import { useTabContext } from "@/hooks/use-tab-context";
import { useKeyboardInset } from "@workspace/ui/hooks/use-keyboard-inset";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect } from "react";

/**
 * The phone's fixed bottom chrome: the mini-player above the tab bar in one
 * container, so the two never race each other for the bottom edge. The safe
 * area sits on the dock rather than the bar, which keeps the bar's hairline
 * above the home indicator instead of on it, and the dock carries the bar's
 * surface so the strip the home indicator sits in reads as part of the bar
 * rather than as a window onto the page scrolling underneath.
 *
 * Both rows can be absent — the tab bar outside a project, `/notes` or
 * `/settings`, the mini-player with nothing loaded — and the container
 * renders nothing rather than paint an empty band when neither has anything
 * to show. Scroll
 * containers clear the dock through `--dock` (globals.css), which reads
 * `body:has([data-slot="tabbar"])` and `body[data-miniplayer]` for each row's
 * share of the height. The tab bar's presence depends only on the pathname,
 * so its CSS selector is already correct at first paint; the mini-player
 * flag below is client-only player state, so it stays an effect.
 *
 * The soft keyboard gets a third flag: `data-keyboard`, from
 * `useKeyboardInset()`, which also collapses `--dock` (globals.css) so
 * nothing pads for a dock that has hidden itself. `--keyboard` carries the
 * same value in pixels for `command.tsx`'s palette, which has no `--dock`
 * to read.
 *
 * `currentProjectId` is the `currentProject` cookie, read server-side in
 * `app/layout.tsx` — it lets the project-scoped tabs resolve an `href` while
 * the route itself carries no project id, on `/notes` and in the settings hub.
 */
export function Dock({
  currentProjectId,
}: {
  currentProjectId: number | null;
}) {
  return (
    <CurrentProjectProvider currentProjectId={currentProjectId}>
      <DockContent />
    </CurrentProjectProvider>
  );
}

function DockContent() {
  const current = useCurrentTrack();
  const tabContext = useTabContext();
  const keyboardInset = useKeyboardInset();
  const hasMiniPlayer = current !== null;
  const hasTabBar = tabContext !== null;
  const hasKeyboard = keyboardInset > 0;

  useEffect(() => {
    document.body.toggleAttribute("data-miniplayer", hasMiniPlayer);
    return () => document.body.removeAttribute("data-miniplayer");
  }, [hasMiniPlayer]);

  useEffect(() => {
    document.body.toggleAttribute("data-keyboard", hasKeyboard);
    document.body.style.setProperty("--keyboard", `${keyboardInset}px`);
    return () => {
      document.body.removeAttribute("data-keyboard");
      document.body.style.removeProperty("--keyboard");
    };
  }, [hasKeyboard, keyboardInset]);

  if (!hasMiniPlayer && !hasTabBar) return null;

  return (
    <div
      hidden={hasKeyboard}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex flex-col bg-paper-sunk pb-[env(safe-area-inset-bottom)] md:hidden",
        hasKeyboard && "hidden"
      )}
    >
      <MiniPlayer />
      <TabBar />
    </div>
  );
}
