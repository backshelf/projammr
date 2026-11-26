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
  commentMarks,
  onMarkerClick,
  showClock,
}: {
  series: WaveSeries;
  size: WaveSize;
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

  const effectiveDuration = duration || series.peaks.length;

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

  const seekFromClick = (clientX: number, rect: DOMRect) => {
    if (!effectiveDuration) return;
    seek(((clientX - rect.left) / rect.width) * effectiveDuration);
  };

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
            className={waveSurface(size)}
            role={"slider"}
            tabIndex={0}
            aria-label={"Seek"}
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDuration)}
            // aria-valuenow, aria-valuetext and --played are written by the
            // progress draw above.
            onClick={(e) =>
              seekFromClick(e.clientX, e.currentTarget.getBoundingClientRect())
            }
            onKeyDown={handleSeekKeys}
          >
            <WaveBars bars={bars} />
          </div>
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
  playerTrack,
  onPlay,
}: {
  series: WaveSeries;
  size: WaveSize;
  playerTrack: MusicPlayerTrack;
  onPlay?: () => void;
}) {
  const { playNow } = usePlayerActions();
  const {
    ref: waveRef,
    bars,
    compareBars,
  } = useWaveBars<HTMLButtonElement>(series);

  return (
    <div className={"relative min-w-0 flex-1"}>
      <WaveStack compareBars={compareBars} size={size}>
        <button
          ref={waveRef}
          type={"button"}
          className={waveSurface(size)}
          // A dedicated "Play {title}" control sits beside this wave wherever
          // both are mounted (TrackAudioSection), so this one names itself as
          // the wave while still saying what pressing it does.
          aria-label={`Play ${playerTrack.title} from the waveform`}
          onClick={() => (onPlay ? onPlay() : playNow([playerTrack]))}
        >
          <WaveBars bars={bars} />
        </button>
      </WaveStack>
    </div>
  );
}

/**
 * The player's wave for one track audio: `@workspace/ui`'s wave parts around
 * a seek slider while its asset is the one playing, or a play button while it
 * is not. The bar count follows the wave's own width.
 */
export function TrackWaveform({
  assetId,
  playerTrack,
  peaks,
  comparePeaks = NO_PEAKS,
  scale,
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
      playerTrack={playerTrack}
      onPlay={onPlay}
    />
  );
}
