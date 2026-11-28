"use client";

import CommentCompose from "@/components/comments/CommentCompose";
import CommentList from "@/components/comments/CommentList";
import {
  useCurrentAssetId,
  useMusicPlayerStore,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { useShellPolicy } from "@/lib/policies/provider";
import type { ActionError, CommentWithReplies } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { EmptySection } from "@workspace/ui/components/layout/empty-section";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useCallback, useMemo, useState } from "react";

type CommentTab = "all" | "mix" | "general";

function TabCount({ count }: { count: number }) {
  return (
    <span className="text-micro text-ink-faint tabular-nums">{count}</span>
  );
}

/**
 * Unified Track COMMENTS section in the page body: shows `All`, `vN Mix notes`
 * (for whichever audio version is currently selected in `TrackAudioProvider`),
 * and `General` (song-level) threads in one place.
 */
export function TrackCommentsSection({
  trackId,
  trackTitle,
  artists,
  generalComments,
}: {
  trackId: number;
  trackTitle: string;
  artists: string[];
  generalComments: CommentWithReplies[] | ActionError;
}) {
  const { selected, comments: mixComments, reloadComments } = useTrackAudio();
  const store = useMusicPlayerStore();
  const { playAt, seek } = usePlayerActions();
  const currentAssetId = useCurrentAssetId();
  const { audioCommentPinned } = useShellPolicy();

  const [tab, setTab] = useState<CommentTab>("all");

  const isLoaded = selected != null && currentAssetId === selected.assetId;
  const pinnedByDefault = audioCommentPinned && isLoaded;
  const selectedId = selected?.id ?? 0;

  const [pinned, setPinned] = useState(pinnedByDefault);
  const [composePosition, setComposePosition] = useState(0);
  const [pinnedFor, setPinnedFor] = useState({ selectedId, isLoaded });
  if (pinnedFor.selectedId !== selectedId || pinnedFor.isLoaded !== isLoaded) {
    setPinnedFor({ selectedId, isLoaded });
    setPinned(pinnedByDefault);
  }

  const capturePosition = useCallback(() => {
    setComposePosition(Math.round(store.getProgress() * 1000));
  }, [store]);

  const handleTogglePinned = useCallback(() => {
    if (!pinned) capturePosition();
    setPinned((value) => !value);
  }, [pinned, capturePosition]);

  const playable = useMemo<MusicPlayerTrack | null>(
    () =>
      selected
        ? {
            title: trackTitle,
            artists,
            asset: selected.asset,
            ownerId: trackId,
            ownerType: "track",
            trackAudio: {
              id: selected.id,
              version: selected.version,
              isPrimary: selected.isPrimary,
              lufs: selected.lufs,
            },
          }
        : null,
    [selected, trackTitle, artists, trackId]
  );

  const handleSeek = useCallback(
    (positionMs: number) => {
      const at = positionMs / 1000;
      if (isLoaded) seek(at);
      else if (playable) playAt(playable, at);
    },
    [isLoaded, seek, playable, playAt]
  );

  const generalList = useMemo(
    () => (isActionError(generalComments) ? [] : generalComments),
    [generalComments]
  );

  const allComments = useMemo(
    () =>
      [...mixComments, ...generalList].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
      ),
    [mixComments, generalList]
  );

  if (!selected) {
    return (
      <EmptySection
        label={"COMMENTS"}
        empty={!isActionError(generalComments) && generalList.length === 0}
        add={"Comment"}
      >
        <section>
          <SectionHead
            count={
              isActionError(generalComments) ? undefined : generalList.length
            }
            prominence={"primary"}
          >
            COMMENTS
          </SectionHead>
          <Arrive>
            <CommentList comments={generalComments} />
          </Arrive>
          <CommentCompose entityType="track" entityId={trackId} />
        </section>
      </EmptySection>
    );
  }

  const totalCount = generalList.length + mixComments.length;
  const empty = !isActionError(generalComments) && totalCount === 0;

  return (
    <EmptySection label={"COMMENTS"} empty={empty} add={"Comment"}>
      <section>
        <SectionHead count={totalCount} prominence={"primary"}>
          COMMENTS
        </SectionHead>
        <Tabs value={tab} onValueChange={(next) => setTab(next as CommentTab)}>
          <TabsList
            variant="line"
            className="mb-3.5 max-w-full overflow-x-auto"
          >
            <TabsTrigger value="all">
              <span>All</span>
              <TabCount count={totalCount} />
            </TabsTrigger>
            <TabsTrigger value="mix">
              <span>v{selected.version} Mix notes</span>
              <TabCount count={mixComments.length} />
            </TabsTrigger>
            <TabsTrigger value="general">
              <span>General</span>
              <TabCount count={generalList.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <Arrive>
              <CommentList
                comments={allComments}
                onSeek={handleSeek}
                onChange={reloadComments}
              />
            </Arrive>
            <CommentCompose entityType="track" entityId={trackId} />
          </TabsContent>

          <TabsContent value="mix">
            <Arrive>
              <CommentList
                comments={mixComments}
                onSeek={handleSeek}
                onChange={reloadComments}
              />
            </Arrive>
            <CommentCompose
              entityType="track_audio"
              entityId={selected.id}
              positionMs={pinned ? composePosition : null}
              onTogglePinned={isLoaded ? handleTogglePinned : undefined}
              onComposeStart={isLoaded && pinned ? capturePosition : undefined}
              onPosted={reloadComments}
            />
          </TabsContent>

          <TabsContent value="general">
            <Arrive>
              <CommentList comments={generalComments} />
            </Arrive>
            <CommentCompose entityType="track" entityId={trackId} />
          </TabsContent>
        </Tabs>
      </section>
    </EmptySection>
  );
}
