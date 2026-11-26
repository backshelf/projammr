import { useEffect, useSyncExternalStore } from "react";

import { call, mediaUrl } from "../bridge";
import { AUDITION_START, RenderPreviewPlayer } from "./preview-player";

/**
 * The panel's one player. A file is allowed in the app first (the asset protocol serves only what the app has been
 * told to), then played from the url the webview reads it at.
 */
export const previewPlayer = new RenderPreviewPlayer(async (path) => {
  await call("allow_media", { path });
  return mediaUrl(path);
});

/**
 * Plays a file, or pauses it while it plays: a file already loaded resumes where it was, a fresh one starts a third of
 * the way in. Resolves once the player has been told to; a refusal to allow the file leaves the card paused.
 */
export function toggleAudition(filePath: string): Promise<void> {
  if (previewPlayer.getSnapshot().filePath === filePath) {
    return previewPlayer.toggle(filePath);
  }
  return previewPlayer.playFrom(filePath, AUDITION_START);
}

/** What one card sees of the preview: its own file's transport, or null while another file (or none) holds it. */
export type PreviewOf = { playing: boolean; at: number; length: number };

/**
 * The transport as one card sees it, as a primitive snapshot so a card re-renders only while its own file is
 * loaded and only when its whole seconds move.
 */
export function usePreviewOf(filePath: string | null): PreviewOf | null {
  const key = useSyncExternalStore(previewPlayer.subscribe, () => {
    const state = previewPlayer.getSnapshot();
    if (filePath === null || state.filePath !== filePath) return "";
    return `${state.playing ? 1 : 0}|${Math.floor(state.currentTime)}|${Math.round(state.duration)}`;
  });
  if (key === "") return null;
  const [playing, at, length] = key.split("|");
  return { playing: playing === "1", at: Number(at), length: Number(length) };
}

/**
 * Lets go of the player when the list of cards leaves the panel, and stops it when the panel loses the person's
 * attention: the panel closes when it is no longer key, and a bounce must not play on behind a closed panel.
 */
export function useReleasePreview(): void {
  useEffect(() => {
    const stop = (): void => previewPlayer.pause();
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      previewPlayer.release();
    };
  }, []);
}
