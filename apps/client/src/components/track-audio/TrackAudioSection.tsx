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
import { usePlayback } from "@/components/music-player/use-playback";
import { analysisOutstanding } from "@/components/track-audio/analysis-outstanding";
import { AudioAnalysisWatcher } from "@/components/track-audio/AudioAnalysisWatcher";
import { AudioCommentPanel } from "@/components/track-audio/AudioCommentPanel";
import {
  AudioCompareControls,
  CompareChangeStrip,
} from "@/components/track-audio/AudioCompareControls";
import { DuplicateFlag } from "@/components/track-audio/DuplicateFlag";
import { FromCommitLink } from "@/components/track-audio/FromCommitLink";
import { LoudnessLabel } from "@/components/track-audio/LoudnessLabel";
import { MeasureStack } from "@/components/track-audio/MeasureStack";
import { useTrackAudio } from "@/components/track-audio/TrackAudioContext";
import { TrackAudioDialog } from "@/components/track-audio/TrackAudioDialog";
import { TrackAudioDropdown } from "@/components/track-audio/TrackAudioDropdown";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import {
  AUDIO_PILL,
  VERSION_CHEVRON,
  VERSION_TRIGGER,
} from "@/components/track-audio/audio-ui";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { useSelectedStrips } from "@/components/track-audio/use-selected-strips";
import { swapVersion } from "@/components/track-audio/use-version-switch";
import { duplicateOfVersion } from "@/components/track-audio/version-rows";
import { TrackWaveform } from "@/components/track/TrackWaveform";
import { DownloadAssetDialog } from "@/components/uploads/DownloadAssetDialog";
import { useProjectRole } from "@/hooks/use-project-role";
import { useVisualsPolicy } from "@/lib/policies/provider";
import {
  IconChevronRight,
  IconDotsVertical,
  IconDownload,
  IconPinFilled,
} from "@tabler/icons-react";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { HeightReveal } from "@workspace/ui/components/height-reveal";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { peakCeiling } from "@workspace/ui/lib/waveform-bars";
import { useCallback, useMemo, useState } from "react";

/** A stable empty array, so a version with no peaks yet does not hand
 *  `peakCeiling`'s memo a fresh reference every render. */
const NO_PEAKS: number[] = [];

function VersionOverflowMenu({
  trackId,
  title,
  playable,
  canEdit,
  onManage,
}: {
  trackId: number;
  title: string;
  playable: MusicPlayerTrack;
  canEdit: boolean;
  onManage: () => void;
}) {
  const { queueNext, queueLast } = usePlayback({
    kind: "track",
    id: trackId,
    title,
    playable,
  });
  const [downloadOpen, setDownloadOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More version actions"
            className={cn(AUDIO_PILL, "px-1.5")}
          >
            <IconDotsVertical aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void queueNext()}>
            Play next
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void queueLast()}>
            Add to queue
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDownloadOpen(true)}>
            <IconDownload aria-hidden />
            Download
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onManage}>
                Manage versions…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DownloadAssetDialog
        assetId={playable.asset.id}
        assetPath={playable.asset.assetPath}
        fileName={playable.asset.name}
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
      />
    </>
  );
}

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

  // Clicking a pin opens the panel, scrolls to the thread, and moves playback
  // to that moment (starting playback if the version was idle).
  const handleMarkerClick = useCallback(
    (ids: number[]) => {
      const first = ids[0];
      if (first === undefined) return;

      const mark = commentMarks.find((candidate) => candidate.id === first);
      if (mark) {
        const at = mark.positionMs / 1000;
        if (isActiveAsset) store.actions.seek(at);
        else if (selectedPlayable) playAt(selectedPlayable, at);
      }

      setCommentsOpen(true);
      scrollToComment(first);
    },
    [
      commentMarks,
      isActiveAsset,
      selectedPlayable,
      store,
      playAt,
      setCommentsOpen,
      scrollToComment,
    ]
  );

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
  const previousAudio =
    selected == null
      ? null
      : (audios
          .filter((audio) => audio.version < selected.version)
          .sort((a, b) => b.version - a.version)[0] ?? null);
  const previousAudioId = previousAudio?.id ?? null;
  const previousVersion = previousAudio?.version ?? null;

  const [selectedStrips, toggleStrip, clearStrips] = useSelectedStrips();
  const [analysisOpen, setAnalysisOpen] = useState(
    () => selectedStrips.length > 0
  );
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
          {/* `PlayAffordance` owns column 1 alone so opening the Analysis
              drawer or toggling strips never shifts the waveform horizontally. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5">
            <PlayAffordance
              kind="track"
              id={trackId}
              title={title}
              playable={selectedPlayable}
              hero
              hideMenu
            />
            <div className="min-w-0 [&>*]:w-full">
              <TrackWaveform
                assetId={selected.assetId}
                playerTrack={selectedPlayable}
                peaks={hearingB ? peaksB : peaksA}
                comparePeaks={hearingB ? peaksA : peaksB}
                scale={scale}
                durationSeconds={durationSeconds}
                size={waveformHeight}
                commentMarks={commentMarks}
                onMarkerClick={handleMarkerClick}
              />
            </div>

            {comparing && (
              <div className="col-start-2 mt-2 min-w-0">
                <CompareChangeStrip
                  comparing={comparing}
                  durationSeconds={durationSeconds}
                />
              </div>
            )}

            {durationMs > 0 && (
              <div className="col-start-2 min-w-0">
                <HeightReveal open={analysisOpen}>
                  <MeasureStack
                    trackAudioId={selected.id}
                    previousAudioId={previousAudioId}
                    previousVersion={previousVersion}
                    durationSeconds={durationSeconds}
                    spectrogramKey={selected.spectrogramKey}
                    selectedIds={selectedStrips}
                    onToggle={toggleStrip}
                    onClear={clearStrips}
                    getSeconds={getSeconds}
                    onSeek={seekTo}
                    live={isActiveAsset}
                  />
                </HeightReveal>
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-micro text-ink-soft phone:gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <TrackAudioDropdown
                audios={audios}
                selectedAudioId={selected.id}
                onSelect={handleSelect}
                onManage={canEdit ? () => setManageOpen(true) : undefined}
              >
                <button
                  type="button"
                  className={cn(VERSION_TRIGGER, "group min-w-0")}
                  aria-label={`${selected.version == null ? "—" : `v${selected.version}`} ${selected.asset.name} — Choose a version`}
                >
                  <IconChevronRight className={VERSION_CHEVRON} />
                  <VersionBadge version={selected.version} active />{" "}
                  <span className="min-w-0 truncate phone:hidden">
                    {selected.asset.name}
                  </span>
                </button>
              </TrackAudioDropdown>

              {selected.isPrimary && selected.primaryPinned && (
                <span
                  role="img"
                  title="Pinned as primary — newer bounces will not replace it"
                  aria-label="Pinned as primary"
                  className="inline-flex shrink-0 items-center text-ink-soft"
                >
                  <IconPinFilled className="size-3" aria-hidden />
                </span>
              )}

              {duplicateVersion != null && (
                <DuplicateFlag
                  version={duplicateVersion}
                  className="flex-none"
                />
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
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2 phone:ml-0">
              {durationMs > 0 && (
                <button
                  type="button"
                  aria-expanded={analysisOpen}
                  onClick={() => setAnalysisOpen((prev) => !prev)}
                  className={cn(
                    AUDIO_PILL,
                    analysisOpen && "border-ink-faint text-ink"
                  )}
                >
                  {(analysisOpen || selectedStrips.length > 0) && (
                    <i aria-hidden className="size-1.5 rounded-full bg-art" />
                  )}
                  <span>Analysis</span>
                  {selectedStrips.length > 0 && (
                    <span className="text-ink-faint tabular-nums">
                      {selectedStrips.length}
                    </span>
                  )}
                </button>
              )}

              <AudioCompareControls
                audios={audios}
                selected={selected}
                toPlayable={toPlayable}
                comparing={comparing}
                onEnd={handleEndCompare}
              />
              <AudioCommentPanel />
              <VersionOverflowMenu
                trackId={trackId}
                title={title}
                playable={selectedPlayable}
                canEdit={canEdit}
                onManage={() => setManageOpen(true)}
              />
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
