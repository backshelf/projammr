"use client";

import { useNowPlaying } from "@/components/music-player/now-playing-context";
import { useCurrentTrack } from "@/components/music-player/player-hooks";
import dynamic from "next/dynamic";
import { useState } from "react";

// A dialog, a drag gesture and a sortable queue: a chunk worth keeping out of
// every page for a surface most sessions never open.
const NowPlaying = dynamic(() => import("./NowPlaying"), { ssr: false });

/**
 * Loads the full now-playing view once something is loaded in the player (or
 * the view is asked for first) and keeps it mounted, shut, afterwards. Loading
 * it ahead of the first open is what lets that open morph the dock's cover
 * into the sheet: a view still arriving suspends, and a suspended destination
 * has no cover to pair with.
 */
export function NowPlayingHost() {
  const { open } = useNowPlaying();
  const current = useCurrentTrack();
  const [everOpened, setEverOpened] = useState(false);

  // Latching during render rather than in an effect: the import starts on the
  // render that loads a track or opens the view, not a commit later.
  if ((open || current) && !everOpened) setEverOpened(true);

  return everOpened ? <NowPlaying /> : null;
}
