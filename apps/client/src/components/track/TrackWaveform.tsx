"use client";

import {
  useCurrentAssetId,
  useDuration,
  useMusicPlayerStore,
  usePlayerActions,
  useProgressFrames,
  writeAttribute,
  writeText,
} from "@/components/music-player/player-hooks";
import { progressReadout } from "@/components/music-player/scrub-math";
import { MusicPlayerTrack } from "@/components/music-player/types";
import {
  useTimelineScrub,
  type TimelineHover,
} from "@/components/track-audio/use-timeline-scrub";
import { seekStep } from "@/lib/policies/playback";
import { usePlaybackPolicy, useVisualsPolicy } from "@/lib/policies/provider";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  playedBars,
  WaveBars,
  WaveMarks,
  WaveStack,
  waveSurface,
  type CommentMark,
  type WaveSize,
} from "@workspace/ui/components/waveform";
import { formatSeconds } from "@workspace/ui/lib/format";
import { cn } from "@workspace/ui/lib/utils";
import { barCountFor, toBars } from "@workspace/ui/lib/waveform-bars";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const NO_PEAKS: number[] = [];

/** The two series a wave draws — the played one in front, a compared one
 *  behind — against the one ceiling they share. */
type WaveSeries = {
  peaks: number[];
  comparePeaks: number[];
  scale: number | undefined;
};

function hoverPillAlignClass(ratio: number): string {
  if (ratio < 0.15) return "translate-x-0";
  if (ratio > 0.85) return "-translate-x-full";
  return "-translate-x-1/2";
}

function WaveHoverGhost({ hover }: { hover: TimelineHover | null }) {
  if (!hover) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-2 inset-y-0 hidden fine:block"
    >
      <span
        className="absolute inset-y-0 w-px bg-ink-faint/60"
        style={{ left: `${hover.ratio * 100}%` }}
      />
      <span
        className={cn(
          "absolute top-1 z-10 rounded-sm border border-rule bg-paper/95 px-1.5 py-0.5 text-micro/none whitespace-nowrap text-ink tabular-nums shadow-menu",
          hoverPillAlignClass(hover.ratio)
        )}
        style={{ left: `${hover.ratio * 100}%` }}
      >
        {formatSeconds(hover.seconds)}
      </span>
    </div>
  );
}

/** Resamples the peaks to however many bars the wave's own width can hold,
 *  observed via ResizeObserver, so a narrow phone wave draws fewer,
 *  still-legible bars instead of compressing 160 fixed-width ones into a
 *  solid block. */
function useWaveBars<T extends HTMLElement>({
  peaks,
  comparePeaks,
  scale,
}: WaveSeries) {
  const ref = useRef<T>(null);
  const { waveformDetail } = useVisualsPolicy();
  const [width, setWidth] = useState(Infinity);
  const count = barCountFor(width, waveformDetail);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const bars = useMemo(
    () => toBars(peaks, count, scale),
    [peaks, count, scale]
  );
  const compareBars = useMemo(
    () => toBars(comparePeaks, count, scale),
    [comparePeaks, count, scale]
  );
  return { ref, bars, compareBars };
}

function ActiveWave({
  series,
  size,
  durationSeconds,
  commentMarks,
  onMarkerClick,
  showClock,
}: {
  series: WaveSeries;
  size: WaveSize;
  durationSeconds: number;
  commentMarks: CommentMark[];
  onMarkerClick?: (ids: number[]) => void;
  showClock: boolean;
}) {
  const duration = useDuration();
  const { getProgress } = useMusicPlayerStore();
  const { seek } = usePlayerActions();
  const playback = usePlaybackPolicy();

  const {
    ref: waveRef,
    bars,
    compareBars,
  } = useWaveBars<HTMLDivElement>(series);
  const leadRef = useRef<HTMLSpanElement>(null);
  const trailRef = useRef<HTMLSpanElement>(null);
  const { playerTime } = useFormat();

  const effectiveDuration = duration || durationSeconds || series.peaks.length;

  useProgressFrames((seconds) => {
    const readout = progressReadout(seconds, effectiveDuration, playerTime);
    const wave = waveRef.current;
    const played = playedBars(readout.fraction, bars.length);
    if (wave && wave.style.getPropertyValue("--played") !== played)
      wave.style.setProperty("--played", played);
    writeAttribute(wave, "aria-valuenow", String(Math.round(readout.position)));
    writeAttribute(wave, "aria-valuetext", readout.valueText);
    writeText(leadRef.current, readout.lead);
    writeText(trailRef.current, readout.trail);
  });

  const { hover, surfaceProps } = useTimelineScrub({
    durationSeconds: effectiveDuration,
    onSeek: seek,
  });

  const seekBy = (seconds: number) =>
    seek(Math.max(0, Math.min(effectiveDuration, getProgress() + seconds)));

  const handleSeekKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!effectiveDuration) return;
    const step = seekStep(playback, event.shiftKey);

    if (event.key === "ArrowRight" || event.key === "ArrowUp") seekBy(step);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      seekBy(-step);
    else if (event.key === "Home") seek(0);
    else if (event.key === "End") seek(effectiveDuration);
    else return;

    event.preventDefault();
  };

  return (
    <div>
      <div className={"relative min-w-0 flex-1"}>
        <WaveMarks
          marks={commentMarks}
          duration={effectiveDuration}
          onMarkerClick={onMarkerClick}
        />
        <WaveStack compareBars={compareBars} size={size}>
          <div
            ref={waveRef}
            className={cn(waveSurface(size), "touch-pan-y select-none")}
            role={"slider"}
            tabIndex={0}
            aria-label={"Seek"}
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDuration)}
            // aria-valuenow, aria-valuetext and --played are written by the
            // progress draw above.
            {...surfaceProps}
            onKeyDown={handleSeekKeys}
          >
            <WaveBars bars={bars} />
          </div>
          <WaveHoverGhost hover={hover} />
        </WaveStack>
      </div>
      {showClock && duration > 0 && (
        <div
          className={
            "mt-1 flex justify-between text-micro text-ink-soft tabular-nums"
          }
        >
          <span ref={leadRef} />
          <span ref={trailRef} />
        </div>
      )}
    </div>
  );
}

function IdleWave({
  series,
  size,
  durationSeconds,
  commentMarks,
  onMarkerClick,
  playerTrack,
  onPlay,
}: {
  series: WaveSeries;
  size: WaveSize;
  durationSeconds: number;
  commentMarks: CommentMark[];
  onMarkerClick?: (ids: number[]) => void;
  playerTrack: MusicPlayerTrack;
  onPlay?: () => void;
}) {
  const { playAt } = usePlayerActions();
  const {
    ref: waveRef,
    bars,
    compareBars,
  } = useWaveBars<HTMLButtonElement>(series);

  const effectiveDuration = durationSeconds || series.peaks.length;
  const { hover, surfaceProps } = useTimelineScrub({
    durationSeconds: effectiveDuration,
    onSeek: (seconds) => {
      if (onPlay) {
        onPlay();
      } else {
        playAt(playerTrack, seconds);
      }
    },
  });

  return (
    <div className={"relative min-w-0 flex-1"}>
      <WaveMarks
        marks={commentMarks}
        duration={effectiveDuration}
        onMarkerClick={onMarkerClick}
      />
      <WaveStack compareBars={compareBars} size={size}>
        <button
          ref={waveRef}
          type={"button"}
          className={cn(waveSurface(size), "touch-pan-y select-none")}
          // A dedicated "Play {title}" control sits beside this wave wherever
          // both are mounted (TrackAudioSection), so this one names itself as
          // the wave while still saying what pressing it does.
          aria-label={`Play ${playerTrack.title} from the waveform`}
          {...surfaceProps}
        >
          <WaveBars bars={bars} />
        </button>
        <WaveHoverGhost hover={hover} />
      </WaveStack>
    </div>
  );
}

/**
 * The player's wave for one track audio: `@workspace/ui`'s wave parts around
 * a seek slider while its asset is the one playing, or a seek-and-play button
 * while it is not. Both states render comment pins, touch-drag scrubbing, and
 * `fine:` hover ghost playhead & timecode pills.
 */
export function TrackWaveform({
  assetId,
  playerTrack,
  peaks,
  comparePeaks = NO_PEAKS,
  scale,
  durationSeconds = 0,
  commentMarks = [],
  onMarkerClick,
  onPlay,
  size = "md",
  showClock = true,
}: {
  assetId: number;
  playerTrack: MusicPlayerTrack;
  /** The series the playhead runs along. */
  peaks: number[];
  /** A second version drawn behind, for an A/B comparison. */
  comparePeaks?: number[];
  /** The ceiling both series are drawn against; defaults to `peaks`' own. */
  scale?: number;
  /** Total duration in seconds for accurate idle pin placement & click-to-seek. */
  durationSeconds?: number;
  commentMarks?: CommentMark[];
  onMarkerClick?: (ids: number[]) => void;
  /** What starting playback from an idle wave means, where the track belongs
   *  to a queue rather than standing alone. */
  onPlay?: () => void;
  size?: WaveSize;
  /** The elapsed and remaining times under a playing wave. Off where the
   *  caller shows its own readout beside the wave. */
  showClock?: boolean;
}) {
  const currentAssetId = useCurrentAssetId();
  const series = useMemo(
    () => ({ peaks, comparePeaks, scale }),
    [peaks, comparePeaks, scale]
  );

  if (currentAssetId === assetId) {
    return (
      <ActiveWave
        series={series}
        size={size}
        durationSeconds={durationSeconds}
        commentMarks={commentMarks}
        onMarkerClick={onMarkerClick}
        showClock={showClock}
      />
    );
  }

  return (
    <IdleWave
      series={series}
      size={size}
      durationSeconds={durationSeconds}
      commentMarks={commentMarks}
      onMarkerClick={onMarkerClick}
      playerTrack={playerTrack}
      onPlay={onPlay}
    />
  );
}
