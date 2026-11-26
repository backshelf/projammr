"use client";

import {
  CLOSED,
  coverArrived,
  opened,
  OPENED_FROM_COVER,
  type NowPlayingState,
} from "@/components/music-player/now-playing-state";
import { usePathname } from "next/navigation";
import {
  createContext,
  startTransition,
  use,
  useCallback,
  useMemo,
  useState,
} from "react";

export type NowPlayingView = "player" | "queue" | "lab";

type NowPlaying = NowPlayingState & {
  setOpen: (open: boolean) => void;
  /** Opens the view from the dock's cover, which grows into the sheet's. */
  openFromCover: () => void;
  view: NowPlayingView;
  setView: (view: NowPlayingView) => void;
};

const NowPlayingContext = createContext<NowPlaying | null>(null);

/**
 * Whether the full now-playing view is showing, and which of its two panes is
 * in front. It is session state rather than a route: the view is a surface
 * over whatever page the listener is on, and closing it must leave them
 * exactly where they were.
 *
 * A surface over a page cannot outlive the page it covers, so a navigation
 * closes it. The links inside it get there by closing first, but a back
 * gesture or the browser's own back button changes the route with nothing to
 * close the view, and it would be left over a page it was never opened from.
 *
 * The cover morphs between the dock and the sheet (`CoverMorph`) by moving
 * its name from one end to the other inside a transition. Closing does both
 * at once. Opening cannot: the sheet's content mounts a commit after its
 * `open` flips, so a single transition would find no cover in the sheet to
 * pair with. The sheet opens first, and the name follows once its content is
 * on the page.
 */
export function NowPlayingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showing, setShowing] = useState(CLOSED);
  const [view, setView] = useState<NowPlayingView>("player");

  const setOpen = useCallback((next: boolean) => {
    if (next) {
      setShowing(opened);
      return;
    }
    startTransition(() => setShowing(CLOSED));
  }, []);
  const openFromCover = useCallback(() => {
    setShowing(OPENED_FROM_COVER);
    // The sheet's presence wrapper renders the popup a commit after `open`,
    // so the frame is what the sheet's own cover waits for and the transition
    // is what keeps the move off the commit that paints it.
    requestAnimationFrame(() =>
      startTransition(() => setShowing(coverArrived))
    );
  }, []);

  // Adjusted during render rather than in an effect: the view is gone on the
  // render that shows the new page, instead of hanging over it for a commit.
  const pathname = usePathname();
  const [covered, setCovered] = useState(pathname);
  if (covered !== pathname) {
    setCovered(pathname);
    setShowing(CLOSED);
  }

  const value = useMemo(
    () => ({ ...showing, setOpen, openFromCover, view, setView }),
    [showing, setOpen, openFromCover, view]
  );

  return <NowPlayingContext value={value}>{children}</NowPlayingContext>;
}

export const useNowPlaying = () => {
  const nowPlaying = use(NowPlayingContext);
  if (!nowPlaying)
    throw new Error("Now-playing hooks require a NowPlayingProvider");
  return nowPlaying;
};
