"use client";

import { NowPlayingProvider } from "@/components/music-player/now-playing-context";
import { NowPlayingHost } from "@/components/music-player/NowPlayingHost";
import { PlayerStoreContext } from "@/components/music-player/player-hooks";
import type { PlayerInitial } from "@/components/music-player/player-initial";
import { createProjectTargetResolver } from "@/components/music-player/project-target";
import { createPlayerStore } from "@/components/music-player/player-store";
import { readEffectiveSettings } from "@/lib/settings/browser-read";
import { useLabPolicy, usePlaybackPolicy } from "@/lib/policies/provider";
import { useEffect, useState } from "react";

/**
 * Mounts the player. `initial` is what the store starts with — read once, when
 * the store is built; after that the store's rules follow the policies
 * provider above, so a changed policy applies without a reload while the
 * listener's own live state (volume, the Lab) stays theirs.
 *
 * Each track normalises to the target of the project it belongs to, read from
 * that project's effective settings, rather than the policy's. A mount with
 * `perProjectTarget` off (the share page, whose guest cannot read project
 * settings) plays every track at the policy's.
 */
export function MusicPlayerProvider({
  initial,
  perProjectTarget = true,
  children,
}: {
  initial: PlayerInitial;
  perProjectTarget?: boolean;
  children: React.ReactNode;
}) {
  // Strict Mode calls this initializer twice and throws one store away, so
  // creating a store must stay free of side effects outside its own audio
  // element — anything document-global belongs in the effect below.
  const [store] = useState(() =>
    createPlayerStore({
      initial,
      resolveProjectTarget: perProjectTarget
        ? createProjectTargetResolver(readEffectiveSettings)
        : undefined,
    })
  );
  const playback = usePlaybackPolicy();
  const lab = useLabPolicy();

  // The OS media keys are a document-global system: claim them while mounted,
  // and release them — along with playback — when the session ends.
  useEffect(() => {
    const release = store.bindMediaSession();
    return () => {
      release();
      store.actions.pause();
    };
  }, [store]);

  useEffect(() => {
    store.setPolicy({ playback, lab });
  }, [store, playback, lab]);

  // A kept queue is fetched afresh from the network, which only a store that
  // mounted should start.
  useEffect(() => {
    store.restoreQueue();
  }, [store]);

  return (
    <PlayerStoreContext value={store}>
      <NowPlayingProvider>
        {/* The view is a surface over whatever page is showing, so it hangs
            off the provider rather than off either of the surfaces that
            open it. */}
        <NowPlayingHost />
        {children}
      </NowPlayingProvider>
    </PlayerStoreContext>
  );
}
