"use client";

import { TRACK_AUDIO_SCOPE } from "@/components/commands/lab";
import { useCommandScope } from "@/components/commands/provider";
import {
  useCompareProgress,
  useCurrentAssetId,
  useMusicPlayerStore,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { CompareState } from "@/components/music-player/player-store";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { AUDIO_PILL } from "@/components/track-audio/audio-ui";
import { ChangeStrip } from "@/components/track-audio/ChangeStrip";
import {
  compareAnnouncement,
  compareControlsView,
  compareStripProps,
  hearSideLabel,
  loudnessMatchable,
  unmatchedCompareLine,
} from "@/components/track-audio/compare-view";
import { TrackAudioDropdown } from "@/components/track-audio/TrackAudioDropdown";
import { IconArrowsLeftRight, IconX } from "@tabler/icons-react";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { Meter } from "@workspace/ui/components/table";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useMemo } from "react";

const SIDES = ["a", "b"] as const;

/**
 * Compares the selected version against another one on the Lab. Idle, it is
 * a "Compare" menu of the other versions; while the comparison prepares, a
 * meter with its progress; once ready, the A · B swap, the loudness match and
 * a way out. `v` swaps from anywhere on the page.
 */
export function AudioCompareControls({
  audios,
  selected,
  toPlayable,
  comparing,
  onEnd,
}: {
  audios: TrackAudioWithAsset[];
  selected: TrackAudioWithAsset;
  toPlayable: (audio: TrackAudioWithAsset) => MusicPlayerTrack;
  /** The comparison, when its A side is `selected`. */
  comparing: CompareState | null;
  /** Ends the comparison, keeping whichever side is heard. */
  onEnd: () => void;
}) {
  const actions = usePlayerActions();
  const currentAssetId = useCurrentAssetId();

  const surface = useMemo(() => ({ comparing }), [comparing]);
  useCommandScope(TRACK_AUDIO_SCOPE, surface, true);

  const others = audios.filter((audio) => audio.id !== selected.id);
  if (others.length === 0) return null;

  const start = (audioId: number) => {
    const other = others.find((audio) => audio.id === audioId);
    if (!other) return;
    if (currentAssetId !== selected.assetId)
      actions.playNow([toPlayable(selected)]);
    actions.startCompare(toPlayable(other));
    actions.play();
  };

  if (!comparing) {
    return (
      <TrackAudioDropdown
        audios={others}
        selectedAudioId={selected.id}
        onSelect={start}
      >
        <button type="button" className={AUDIO_PILL}>
          <IconArrowsLeftRight />
          Compare
        </button>
      </TrackAudioDropdown>
    );
  }

  const versions = {
    a: selected.version,
    b: comparing.b.trackAudio?.version,
  };
  const measured = loudnessMatchable(
    selected.lufs,
    comparing.b.trackAudio?.lufs
  );

  return (
    <div className="flex items-center gap-2">
      <span role="status" className="sr-only">
        {compareAnnouncement(comparing)}
      </span>

      {comparing.phase === "ready" ? (
        <>
          <SegmentedPill
            aria-label="Compare versions"
            options={SIDES.map((side) => ({
              value: side,
              label: side.toUpperCase(),
              "aria-label": hearSideLabel(side, versions[side]),
            }))}
            value={comparing.active}
            onValueChange={(side) => {
              if (side !== comparing.active) actions.swapCompare();
            }}
          />

          {comparing.unmatched ? (
            <span className="text-micro text-ink-soft">
              {unmatchedCompareLine(
                selected.lufs,
                comparing.b.trackAudio?.lufs
              )}
            </span>
          ) : (
            <TogglePill
              pressed={measured && comparing.matched}
              onPressedChange={(next) => actions.setCompareMatched(next)}
              disabled={!measured}
              title={
                measured
                  ? undefined
                  : "Both versions need a loudness measurement"
              }
            >
              Match loudness
            </TogglePill>
          )}
        </>
      ) : (
        <ComparePhase comparing={comparing} />
      )}

      <button
        type="button"
        aria-label="End comparison"
        className={cn(AUDIO_PILL, "px-[0.1875rem]")}
        onClick={onEnd}
      >
        <IconX />
      </button>
    </div>
  );
}

/**
 * A comparison that is not ready yet: its progress, or why it cannot run.
 * The only reader of the preparing progress, so a download's percent
 * re-renders this line and nothing around it.
 */
export function ComparePhase({
  comparing,
  className,
}: {
  comparing: CompareState;
  className?: string;
}) {
  const fraction = useCompareProgress();
  const view = compareControlsView(
    comparing,
    comparing.b.trackAudio?.version,
    fraction
  );
  if (view.kind === "ready") return null;
  if (view.kind === "unavailable") {
    return <p className={cn("text-micro text-ink", className)}>{view.line}</p>;
  }
  return (
    <div className={cn("flex min-w-32 flex-col gap-1", className)}>
      <Meter aria-label={view.label} value={view.percent} />
      <p className="text-micro text-ink-soft">{view.line}</p>
    </div>
  );
}

/**
 * The comparison's change map under the two waveforms, on A's timeline, when
 * the pair has one. Reading the position and seeking go through the player
 * rather than the section's own version seek, since both sides of a
 * comparison play on A's clock.
 */
export function CompareChangeStrip({
  comparing,
  durationSeconds,
}: {
  comparing: CompareState;
  durationSeconds: number;
}) {
  const store = useMusicPlayerStore();
  const getSeconds = useCallback(() => store.getProgress(), [store]);
  const onSeek = useCallback(
    (seconds: number) => store.actions.seek(seconds),
    [store]
  );
  const strip = compareStripProps(comparing);
  if (!strip || durationSeconds <= 0) return null;
  return (
    <ChangeStrip
      label={strip.label}
      change={strip.change}
      summary={strip.summary}
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
    />
  );
}
