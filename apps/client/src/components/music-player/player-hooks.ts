"use client";

import {
  audibleSide,
  comparedSide,
} from "@/components/music-player/audible-side";
import {
  PlayerSnapshot,
  PlayerStore,
} from "@/components/music-player/player-store";
import { imageUrl } from "@/lib/utils";
import { artVarsFromAccent, type ArtVars } from "@workspace/ui/lib/art";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export const PlayerStoreContext = createContext<PlayerStore | null>(null);

export const useMusicPlayerStore = () => {
  const store = use(PlayerStoreContext);
  if (!store)
    throw new Error("Music player hooks require a MusicPlayerProvider");
  return store;
};

const usePlayer = <T>(select: (snapshot: PlayerSnapshot) => T): T => {
  const store = useMusicPlayerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(store.getServerSnapshot())
  );
};

const selectCurrent = (s: PlayerSnapshot) => s.current;
const selectCurrentAssetId = (s: PlayerSnapshot) => s.current?.asset.id ?? null;
const selectUpcoming = (s: PlayerSnapshot) => s.upcoming;
const selectIsPlaying = (s: PlayerSnapshot) => s.isPlaying;
const selectDuration = (s: PlayerSnapshot) => s.duration;
const selectLoadError = (s: PlayerSnapshot) => s.loadError;
const selectPrefs = (s: PlayerSnapshot) => s.prefs;
const selectVolumeControllable = (s: PlayerSnapshot) => s.volumeControllable;
const selectCompare = (s: PlayerSnapshot) => s.compare;
const selectAnalyser = (s: PlayerSnapshot) => s.analyser;
const selectRouted = (s: PlayerSnapshot) => s.routed;
const selectLab = (s: PlayerSnapshot) => s.lab;
const selectLabSettings = (s: PlayerSnapshot) => s.lab.settings;
const selectLabTarget = (s: PlayerSnapshot) => s.lab.targetLufs;
const selectBounce = (s: PlayerSnapshot) => s.bounce;
const selectCompareProgress = (s: PlayerSnapshot) => s.compareProgress;
const selectAudibleSide = (s: PlayerSnapshot) =>
  audibleSide(s.compare, s.lab.phase === "live");
const selectComparedSide = (s: PlayerSnapshot) => comparedSide(s.compare);

export const useCurrentTrack = () => usePlayer(selectCurrent);
export const useCurrentAssetId = () => usePlayer(selectCurrentAssetId);
export const useUpcoming = () => usePlayer(selectUpcoming);
export const useIsPlaying = () => usePlayer(selectIsPlaying);
export const useDuration = () => usePlayer(selectDuration);
/** The current asset's audio load failure, or null; `usePlayerActions().retry` reloads it. */
export const useLoadError = () => usePlayer(selectLoadError);
export const usePlayerPrefs = () => usePlayer(selectPrefs);
export const usePlayerActions = () => useMusicPlayerStore().actions;
/** The A/B comparison in progress, or null. */
export const useCompare = () => usePlayer(selectCompare);
/**
 * A preparing comparison's progress, 0..1. Selected on its own, so a
 * download's progress re-renders only the one line that shows it.
 */
export const useCompareProgress = () => usePlayer(selectCompareProgress);
/** Which live meter side is heard: a compared source, the Lab's output, or the element. */
export const useAudibleSide = () => usePlayer(selectAudibleSide);
/** The compared source that is not heard, while a comparison is ready; else null. */
export const useComparedSide = () => usePlayer(selectComparedSide);
/** The Lab's settings and phase; re-renders on preparing progress too. */
export const useLab = () => usePlayer(selectLab);
/** The Lab's settings alone, steady while the Lab prepares. */
export const useLabSettings = () => usePlayer(selectLabSettings);
/** The normalise target the playing track is heard at, for naming it. */
export const useLabTarget = () => usePlayer(selectLabTarget);
/**
 * A bounce's lifecycle, or null. Selected on its own — rather than through
 * `useLab` — so a checkpoint only re-renders the Bounce section, not every
 * reader of the Lab's settings and phase.
 */
export const useBounce = () => usePlayer(selectBounce);

/**
 * Whether to offer a volume control at all. iOS keeps the volume to itself, so
 * there the slider would move without changing anything; muting still works.
 */
export const useVolumeControllable = () => usePlayer(selectVolumeControllable);

/**
 * Whether the loaded item is this owner (and, for a track, this asset). A
 * boolean selector, so a row's play control re-renders only when its own
 * answer changes rather than on every queue change.
 */
export const useIsCurrent = (
  kind: "track" | "collection",
  id: number,
  assetId?: number
) =>
  usePlayer(
    useCallback(
      (s: PlayerSnapshot) => {
        const current = s.current;
        if (!current) return false;
        if (kind === "collection") return current.collectionId === id;
        return (
          current.ownerType === "track" &&
          current.ownerId === id &&
          (assetId === undefined || current.asset.id === assetId)
        );
      },
      [kind, id, assetId]
    )
  );

/**
 * The playing track's accent as the `--art-*` channel (resolved to `--art` by
 * theme in `globals.css`) plus `--art-image`, for the player to tint itself by
 * what is loaded rather than by the page it sits on. Grayscale until a track
 * with a resolved accent is playing.
 */
export const useCurrentArt = (): ArtVars => {
  const current = useCurrentTrack();
  const hue = current?.accentHue;
  const chroma = current?.accentChroma;
  const cover = current?.cover;

  return useMemo(
    () => artVarsFromAccent(hue, chroma, cover ? imageUrl(cover, 256) : null),
    [hue, chroma, cover]
  );
};

/**
 * The engine's analyser: null until a surface calls {@link useAnalysis} and
 * the graph comes up, and null for good where Web Audio is unavailable or the
 * context would not start. Selected from the snapshot, since a reader can
 * mount well before the node exists and has to re-render when it arrives.
 */
export const useAnalyser = () => usePlayer(selectAnalyser);

/**
 * Whether playback currently runs through Web Audio rather than the
 * elements' own output — what `useSideFrames` gates on, and what `LavaField`
 * draws its resting frame without.
 */
export const useRouted = () => usePlayer(selectRouted);

/**
 * Declares that this surface reads the audio itself — the scope, the live
 * meters — and asks the player to route playback through Web Audio so that
 * there is something to read.
 *
 * This is the one thing that stops a phone playing with the screen off: iOS
 * suspends an AudioContext when the device locks, and an element routed
 * through one falls silent with it. The engine's `requestAnalysis` is where
 * that rule lives — a no-op on a coarse pointer, whatever asked — so this
 * hook always asks and never has to know the pointer type itself. The room's
 * breath never asks: it shows a live level when something else has turned
 * the graph on, and rests when nothing has.
 *
 * `wanted` lets a surface ask only while it has something to show; once the
 * graph is up it stays up, so turning it false again changes nothing.
 */
export const useAnalysis = (wanted = true) => {
  const { requestAnalysis } = usePlayerActions();
  useEffect(() => {
    if (wanted) requestAnalysis();
  }, [wanted, requestAnalysis]);
};

/**
 * Whether the sheet's "Lab on" notice belongs on screen: routed audio on a
 * device with a lock screen to lose it, which only an explicit request (a
 * comparison, or an engaged Lab) can have caused.
 */
export function showsRoutedNotice(routed: boolean, coarse: boolean): boolean {
  return routed && coarse;
}

/** {@link showsRoutedNotice} against the live snapshot and pointer type. */
export const useRoutedNotice = () => {
  const routed = useRouted();
  const coarse = useCoarsePointer();
  return showsRoutedNotice(routed, coarse);
};

/**
 * Calls `draw` with the playhead position on every progress emission (one per
 * animation frame while playing) and after every commit of the calling
 * component, so a changed duration, drag or bar count repaints at once even
 * while paused.
 *
 * The position never enters React state: `useSyncExternalStore` updates are
 * blocking, and one per frame restarts every navigation transition before it
 * can commit. `draw` writes the DOM directly, as `useLoudnessFrames` does.
 * Anything that needs the position at event time reads
 * `useMusicPlayerStore().getProgress()` instead.
 */
export function useProgressFrames(draw: (seconds: number) => void) {
  const store = useMusicPlayerStore();
  const drawRef = useLatestRef(draw);

  // Layout, not passive, so a remount paints the position before the browser
  // shows the empty readout. It calls this render's `draw` directly: the ref
  // only catches up in a passive effect, after this one.
  useLayoutEffect(() => {
    draw(store.getProgress());
  });

  useEffect(
    () => store.subscribeProgress((seconds) => drawRef.current(seconds)),
    [store, drawRef]
  );
}

/** Sets a text node only when it changed; a draw runs every frame but the
 *  clock moves once a second. */
export function writeText(node: Node | null, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

/** Sets an attribute only when it changed, for the same reason as
 *  {@link writeText}. */
export function writeAttribute(
  element: Element | null,
  name: string,
  value: string
) {
  if (element && element.getAttribute(name) !== value)
    element.setAttribute(name, value);
}
