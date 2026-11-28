"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Artwork, Sharelink } from "@workspace/api/api";
import { ArtProvider } from "@/components/art/ArtProvider";
import { CommentBackendProvider } from "@/components/comments/comment-backend";
import {
  useCurrentAssetId,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { shareCommentBackend } from "@/components/share/share-backend";
import {
  shareCoverUrl,
  shareEntries,
  type ShareEntry,
} from "@/components/share/share-playables";
import { useCommentThread } from "@/components/track-audio/AudioCommentSection";

/**
 * Everything the share page's parts read: the queue as entries, which one the
 * page is showing, the current entry's thread and the ways to move around it.
 */
export type ShareRoom = {
  token: string;
  sharelink: Sharelink;
  /** The reader's user id — guest or member — or null when they hold no
   *  session at all and can therefore only read. */
  viewerId: string | null;
  entries: ShareEntry[];
  /** The entry the page shows: the one the player holds, else the reader's pick. */
  index: number;
  entry: ShareEntry | undefined;
  /** Whether the player holds one of this share's entries. */
  loaded: boolean;
  /** The current entry's cover, served by the share's own route; null when it
   *  has none. */
  artwork: Artwork | null;
  select(index: number): void;
  start(): void;
  seek(positionMs: number): void;
  jumpToComment(ids: number[]): void;
  thread: ReturnType<typeof useCommentThread>;
};

export const ShareRoomContext = createContext<ShareRoom | null>(null);

export const useShareRoom = (): ShareRoom => {
  const room = use(ShareRoomContext);
  if (!room) throw new Error("useShareRoom requires a ShareRoomProvider");
  return room;
};

/**
 * The share page's room: holds the page state and lights it. The art field
 * recedes as the page scrolls and brightens while this share plays, and the
 * element {@link ArtProvider} renders is the one the page scrolls in.
 */
export function ShareRoomProvider({
  token,
  sharelink,
  viewerId,
  children,
}: PropsWithChildren<{
  token: string;
  sharelink: Sharelink;
  viewerId: string | null;
}>) {
  const entries = useMemo(
    () => shareEntries(token, sharelink.tracks),
    [token, sharelink.tracks]
  );

  const { playNow, playAt } = usePlayerActions();
  const currentAssetId = useCurrentAssetId();

  // Whichever entry the player holds wins over the reader's last pick, so the
  // page follows the queue when a track ends and the next one starts.
  const playingIndex = entries.findIndex(
    (candidate) => candidate.assetId === currentAssetId
  );
  const [picked, setPicked] = useState(0);
  const index = playingIndex >= 0 ? playingIndex : picked;
  const entry = entries[index];
  const loaded = playingIndex >= 0;

  const backend = useMemo(
    () => shareCommentBackend(token, viewerId),
    [token, viewerId]
  );
  const thread = useCommentThread(entry?.trackAudioId ?? 0, backend);
  const { commentMarks, scrollToComment } = thread;

  const entryArtwork = entry
    ? sharelink.tracks.find(
        (track) => track.trackAudio.id === entry.trackAudioId
      )?.artwork
    : null;
  const artwork = useMemo(
    () =>
      entry && entryArtwork
        ? {
            ...entryArtwork,
            assetPath: shareCoverUrl(token, entry.trackAudioId),
          }
        : null,
    [token, entry, entryArtwork]
  );

  const select = useCallback(
    (next: number) => {
      setPicked(next);
      playNow(
        entries.map((candidate) => candidate.playable),
        next
      );
    },
    [playNow, entries]
  );

  const start = useCallback(
    () =>
      playNow(
        entries.map((candidate) => candidate.playable),
        index
      ),
    [playNow, entries, index]
  );

  /**
   * A timecode is worth following before anything is playing, so on a share
   * that has not been started yet it starts it there rather than doing
   * nothing. `playAt` carries the position through the load; seeking an
   * element that has no metadata yet would be dropped.
   */
  const seek = useCallback(
    (positionMs: number) => {
      if (entry) playAt(entry.playable, positionMs / 1000);
    },
    [playAt, entry]
  );

  const jumpToComment = useCallback(
    (ids: number[]) => {
      const first = ids[0];
      if (first === undefined) return;
      const mark = commentMarks.find((candidate) => candidate.id === first);
      if (mark) seek(mark.positionMs);
      scrollToComment(first);
    },
    [commentMarks, seek, scrollToComment]
  );

  const room = useMemo<ShareRoom>(
    () => ({
      token,
      sharelink,
      viewerId,
      entries,
      index,
      entry,
      loaded,
      artwork,
      select,
      start,
      seek,
      jumpToComment,
      thread,
    }),
    [
      token,
      sharelink,
      viewerId,
      entries,
      index,
      entry,
      loaded,
      artwork,
      select,
      start,
      seek,
      jumpToComment,
      thread,
    ]
  );

  return (
    <ShareRoomContext value={room}>
      <ArtProvider
        artwork={artwork}
        playing={
          entry ? { kind: "track", id: entry.playable.ownerId } : undefined
        }
        className={
          "relative isolate h-full overflow-y-auto overscroll-y-contain"
        }
      >
        <CommentBackendProvider backend={backend}>
          {children}
        </CommentBackendProvider>
      </ArtProvider>
    </ShareRoomContext>
  );
}
