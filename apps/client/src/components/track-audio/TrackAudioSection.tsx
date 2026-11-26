"use client";

import { useEntityKey } from "@/components/commands/entity-surface";
import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import {
  useCompare,
  useCurrentAssetId,
  useIsPlaying,
  useMusicPlayerStore,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { analysisOutstanding } from "@/components/track-audio/analysis-outstanding";
import { AudioAnalysisWatcher } from "@/components/track-audio/AudioAnalysisWatcher";
import {
  AudioCompareControls,
  CompareChangeStrip,
} from "@/components/track-audio/AudioCompareControls";
import { AudioCommentPanel } from "@/components/track-audio/AudioCommentPanel";
import { FromCommitLink } from "@/components/track-audio/FromCommitLink";
import { DuplicateFlag } from "@/components/track-audio/DuplicateFlag";
import { MeasureStack } from "@/components/track-audio/MeasureStack";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { TrackAudioDialog } from "@/components/track-audio/TrackAudioDialog";
import { LoudnessLabel } from "@/components/track-audio/LoudnessLabel";
import { TrackAudioDropdown } from "@/components/track-audio/TrackAudioDropdown";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { useSelectedStrips } from "@/components/track-audio/use-selected-strips";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { swapVersion } from "@/components/track-audio/use-version-switch";
import { duplicateOfVersion } from "@/components/track-audio/version-rows";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { TrackWaveform } from "@/components/track/TrackWaveform";
import { peakCeiling } from "@workspace/ui/lib/waveform-bars";
import {
  AUDIO_PILL,
  VERSION_CHEVRON,
  VERSION_TRIGGER,
} from "@/components/track-audio/audio-ui";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconChevronRight } from "@tabler/icons-react";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { useCallback, useMemo, useState } from "react";

/** A stable empty array, so a version with no peaks yet does not hand
 *  `peakCeiling`'s memo a fresh reference every render. */
const NO_PEAKS: number[] = [];

export function TrackAudioSection({
  trackId,
  title,
  artists,
}: {
  trackId: number;
  title: string;
  artists: string[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? false;
  const [manageOpen, setManageOpen] = useState(false);
  useEntityKey("upload", () => setManageOpen(true), canEdit);

  const store = useMusicPlayerStore();
  const { playAt, endCompare } = usePlayerActions();
  const currentAssetId = useCurrentAssetId();
  const isPlaying = useIsPlaying();
  const compare = useCompare();

  const {
    audios,
    primaryAudio,
    selected,
    setSelectedAudioId,
    commentMarks,
    scrollToComment,
    setCommentsOpen,
  } = useTrackAudio();

  const viewingHistory = !!selected && !selected.isPrimary;

  // The player holds one comparison app-wide; this section shows it only when
  // its A side is the version selected here.
  const comparing =
    compare && selected && currentAssetId === selected.assetId ? compare : null;

  const peaksA =
    useTrackAudioMeasure<number[]>(selected?.id ?? null, "peaks") ?? NO_PEAKS;
  const peaksB =
    useTrackAudioMeasure<number[]>(
      comparing?.b.trackAudio?.id ?? null,
      "peaks"
    ) ?? NO_PEAKS;
  const scale = useMemo(() => peakCeiling(peaksA, peaksB), [peaksA, peaksB]);
  // The playhead runs along whichever side is audible; the other stays behind.
  const hearingB = comparing?.active === "b";

  // Clicking a pin opens the panel and scrolls to the thread it belongs to.
  const handleMarkerClick = useCallback(
    (ids: number[]) => {
      const first = ids[0];
      if (first === undefined) return;

      const mark = commentMarks.find((candidate) => candidate.id === first);
      if (mark) store.actions.seek(mark.positionMs / 1000);

      setCommentsOpen(true);
      scrollToComment(first);
    },
    [commentMarks, store, setCommentsOpen, scrollToComment]
  );

  const toPlayable = useCallback(
    (audio: TrackAudioWithAsset): MusicPlayerTrack => ({
      title,
      artists,
      asset: audio.asset,
      ownerId: trackId,
      ownerType: "track",
      trackAudio: {
        id: audio.id,
        version: audio.version,
        isPrimary: audio.isPrimary,
        lufs: audio.lufs,
      },
    }),
    [title, artists, trackId]
  );

  const selectedPlayable = selected ? toPlayable(selected) : null;

  // The strips read the version's own known duration rather than the
  // player's live one, so they draw whether or not this version is playing.
  const durationMs = selected?.durationMs ?? 0;
  const durationSeconds = durationMs / 1000;
  const isActiveAsset =
    !!selected && currentAssetId === selected.assetId && !hearingB;

  const getSeconds = useCallback(
    () => (isActiveAsset ? store.getProgress() : 0),
    [isActiveAsset, store]
  );
  // Scrubbing a strip is worth following before anything is playing, so this
  // goes through `playAt` whether or not the version is the loaded one: it
  // seeks and starts there rather than only moving a playhead nobody is on.
  const seekTo = useCallback(
    (seconds: number) => {
      if (selectedPlayable) playAt(selectedPlayable, seconds);
    },
    [selectedPlayable, playAt]
  );

  // The version immediately behind the one shown, if the page knows of one:
  // what `ChangeStrip`'s consecutive diff compares against.
  const previousAudioId =
    selected == null
      ? null
      : (audios
          .filter((audio) => audio.version < selected.version)
          .sort((a, b) => b.version - a.version)[0]?.id ?? null);

  const [selectedStrips, toggleStrip] = useSelectedStrips();
  const { waveformHeight } = useVisualsPolicy();

  const duplicateVersion = selected
    ? duplicateOfVersion(selected.duplicateOfId, audios)
    : null;

  // Ending on B leaves B playing as the current track, so the section follows
  // it to that version rather than showing A beside a playhead it no longer has.
  const handleEndCompare = useCallback(() => {
    const kept = comparing?.phase === "ready" && comparing.active === "b";
    const bId = comparing?.b.trackAudio?.id;
    endCompare();
    if (kept && bId != null) setSelectedAudioId(bId);
  }, [comparing, endCompare, setSelectedAudioId]);

  const handleSelect = useCallback(
    (audioId: number) => {
      if (comparing) endCompare();
      setSelectedAudioId(audioId);
      const next = audios.find((audio) => audio.id === audioId);
      if (!next) return;
      const wasActive =
        isPlaying &&
        currentAssetId !== null &&
        currentAssetId === selected?.assetId;
      if (wasActive && next.assetId !== selected?.assetId && selectedPlayable) {
        playAt(swapVersion(selectedPlayable, next), store.getProgress());
      }
    },
    [
      comparing,
      endCompare,
      audios,
      setSelectedAudioId,
      isPlaying,
      currentAssetId,
      selected?.assetId,
      selectedPlayable,
      playAt,
      store,
    ]
  );

  return (
    <m.div {...useArrival("audio")} className="group/track-play mt-6">
      {selected && selectedPlayable ? (
        <>
          {/* One grid, `[auto_minmax(0,1fr)]`: the play affordance and every
              strip's label share the first (content-sized) column, the
              waveform and every strip's seek surface the second, so a
              strip's x-axis lines up with the waveform's own bars however
              wide the play affordance renders. `MeasureStack` and each
              `StripRow` inherit these same two tracks through
              `grid-cols-subgrid` rather than sizing a label column of
              their own. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5">
            <PlayAffordance
              kind="track"
              id={trackId}
              title={title}
              playable={selectedPlayable}
              hero
              menuClassName="fine:motion-reveal fine:opacity-0 fine:group-hover/track-play:opacity-100 fine:focus-visible:opacity-100 group-data-[active]/play:opacity-100"
            />
            <div className="min-w-0 [&>*]:w-full">
              <TrackWaveform
                assetId={selected.assetId}
                playerTrack={selectedPlayable}
                peaks={hearingB ? peaksB : peaksA}
                comparePeaks={hearingB ? peaksA : peaksB}
                scale={scale}
                size={waveformHeight}
                commentMarks={commentMarks}
                onMarkerClick={handleMarkerClick}
              />
            </div>

            {comparing && (
              <CompareChangeStrip
                comparing={comparing}
                durationSeconds={durationSeconds}
              />
            )}

            {durationMs > 0 && (
              <MeasureStack
                trackAudioId={selected.id}
                previousAudioId={previousAudioId}
                durationSeconds={durationSeconds}
                spectrogramKey={selected.spectrogramKey}
                selectedIds={selectedStrips}
                onToggle={toggleStrip}
                getSeconds={getSeconds}
                onSeek={seekTo}
                live={isActiveAsset}
              />
            )}
          </div>

          {/* On a phone the identity of what is playing (version, loudness)
              keeps the first line and the actions take one of their own; the
              trigger only grows where it has a filename to grow for. */}
          <div className="mt-2 flex flex-wrap items-center gap-3 gap-y-1.5 text-micro text-ink-soft phone:gap-y-2">
            <TrackAudioDropdown
              audios={audios}
              selectedAudioId={selected.id}
              onSelect={handleSelect}
              onManage={canEdit ? () => setManageOpen(true) : undefined}
            >
              <button
                type="button"
                className={cn(VERSION_TRIGGER, "group flex-1 phone:flex-none")}
                aria-label="Choose a version"
              >
                <IconChevronRight className={VERSION_CHEVRON} />
                <VersionBadge version={selected.version} active />
                <span className="min-w-0 truncate phone:hidden">
                  {selected.asset.name}
                  {selected.isPrimary && " · Primary"}
                </span>
              </button>
            </TrackAudioDropdown>

            {selected.isPrimary && selected.primaryPinned && (
              <StatusChip
                flag
                colour="var(--ink-soft)"
                title="Pinned as primary — newer bounces will not replace it"
                className="flex-none"
              >
                Pinned
              </StatusChip>
            )}

            {duplicateVersion != null && (
              <DuplicateFlag version={duplicateVersion} className="flex-none" />
            )}

            <LoudnessLabel
              lufs={selected.lufs}
              truePeakDb={selected.truePeakDb}
            />
            <FromCommitLink audio={selected} trackId={trackId} />
            {analysisOutstanding(selected) && (
              <AudioAnalysisWatcher key={selected.id} eachJob />
            )}

            {viewingHistory && primaryAudio && (
              <button
                type="button"
                className={AUDIO_PILL}
                onClick={() => handleSelect(primaryAudio.id)}
              >
                Back to primary
              </button>
            )}

            <div className="ml-auto flex items-center gap-2 phone:ml-0 phone:basis-full">
              <AudioCompareControls
                audios={audios}
                selected={selected}
                toPlayable={toPlayable}
                comparing={comparing}
                onEnd={handleEndCompare}
              />
              <AudioCommentPanel />
            </div>
          </div>
        </>
      ) : canEdit ? (
        <button
          type="button"
          className={AUDIO_PILL}
          onClick={() => setManageOpen(true)}
        >
          Add a track audio
        </button>
      ) : null}

      {canEdit && (
        <TrackAudioDialog
          trackId={trackId}
          open={manageOpen}
          onOpenChange={setManageOpen}
        />
      )}
    </m.div>
  );
}
