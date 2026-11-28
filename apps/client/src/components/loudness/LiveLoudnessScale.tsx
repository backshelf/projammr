"use client";

import { belongsTo, type PlaybackOwner } from "@/components/art/playing-light";
import {
  LoudnessScale,
  type LoudnessMark,
} from "@workspace/ui/components/loudness/loudness-scale";
import { LoudnessUnit } from "@workspace/ui/components/loudness/loudness-unit";
import {
  useLoudnessFrames,
  type LiveSides,
} from "@/components/loudness/use-loudness-frames";
import { LabCaption } from "@/components/loudness/LabCaption";
import {
  useAnalysis,
  useAudibleSide,
  useComparedSide,
  useCurrentTrack,
  useIsPlaying,
} from "@/components/music-player/player-hooks";
import { useFormat } from "@workspace/ui/components/format-provider";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { formatSignedDecimal } from "@workspace/ui/lib/loudness";
import {
  follow,
  holdPeak,
  meterFraction,
  scaledBallistics,
  type PeakHold,
} from "@/lib/meter-ballistics";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

/** A meter's needle: up in a frame or two, down over a third of a second. */
const NEEDLE = { attackMs: 12, releaseMs: 320 };
/** The momentary bar is faster still, so a snare reads as a flick. */
const BAR = { attackMs: 6, releaseMs: 180 };
/** The highest momentary level lingers as a tick, then falls 8 LU a second. */
const HOLD = { holdMs: 1400, fallPerSecond: 8 };
/** Peak figures hold longer, since they are read rather than watched. */
const PEAK_HOLD = { holdMs: 2400, fallPerSecond: 12 };
/** The figures change a few times a second — any faster and they can't be read. */
const READOUT_MS = 160;

type SideState = {
  bar: number;
  needle: number;
  hold: PeakHold;
  peak: PeakHold;
};

const restingSide = (): SideState => ({
  bar: 0,
  needle: 0,
  hold: { value: 0, heldMs: 0 },
  peak: { value: -Infinity, heldMs: 0 },
});

// Resting transforms as inline styles, the same property the frame loop
// writes. Tailwind's `scale-x-0`/`translate-x-0` set the separate `scale` and
// `translate` properties, which would compose with it instead of being
// replaced. Constant objects, so a re-render never writes them back over a
// moving needle.
const AT_FLOOR = { transform: "scaleX(0)" };
const AT_START = { transform: "translateX(0%)" };

const SIDES = ["a", "b", "mix"] as const;

const figure = (lufs: number, format: Formatters) =>
  Number.isFinite(lufs) && lufs > -70 ? format.lufs(lufs) : "—";

/**
 * {@link LoudnessScale} with the playing audio's level running along it, while
 * the audio belongs to `owner`: a momentary bar over the baseline, the highest
 * recent momentary level held as a tick, and the short-term level as a
 * needle. Above the ruler, the same three as figures, led by `caption` where
 * the block needs naming. It reads the file's own level (the meters tap each
 * source before its gain), so the needle agrees with the integrated ticks it
 * moves among.
 *
 * During an A/B comparison both sources are metered: the audible one draws in
 * ink, the other as a faint needle, so a remaster's jump in level is visible
 * while it plays. While the Lab plays without a comparison, the meter reads
 * the Lab's output, and a captioned meter says so.
 *
 * Everything moving is written straight to the DOM from one frame loop; React
 * renders only when the meter comes on or goes off. Under reduced motion the
 * graphics stay still and only the figures update.
 */
export function LiveLoudnessScale({
  owner,
  marks,
  band,
  pointer,
  label,
  caption,
  tone = "paper",
  className,
}: {
  owner: PlaybackOwner | "any";
  marks: LoudnessMark[];
  band?: [number, number];
  pointer?: number;
  label: string;
  /** Leads the figure row, for a surface where nothing else names the meter. */
  caption?: string;
  tone?: "paper" | "art";
  className?: string;
}) {
  const current = useCurrentTrack();
  const isPlaying = useIsPlaying();
  const audible = useAudibleSide();
  const other = useComparedSide();
  const reduced = useReducedMotion();
  const format = useFormat();
  const { loudnessReferenceLufs, meterBallistics } = useVisualsPolicy();
  const bar = scaledBallistics(BAR, meterBallistics);
  const needle = scaledBallistics(NEEDLE, meterBallistics);

  const mine = owner === "any" ? current != null : belongsTo(current, owner);
  const live = mine && isPlaying;
  const comparing = live && other != null;
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleLive = live && visible;

  useAnalysis(live);

  const barRef = useRef<HTMLElement>(null);
  const holdRef = useRef<HTMLElement>(null);
  const needleRef = useRef<HTMLElement>(null);
  const otherNeedleRef = useRef<HTMLElement>(null);
  const momentaryRef = useRef<HTMLElement>(null);
  const shortTermRef = useRef<HTMLElement>(null);
  const peakRef = useRef<HTMLElement>(null);

  const stateRef = useRef({
    sides: { a: restingSide(), b: restingSide(), mix: restingSide() },
    sinceText: 0,
  });

  useLoudnessFrames(visibleLive, (sides: LiveSides, dt, active) => {
    if (!active && !visible) return false;
    const s = stateRef.current;
    let moving = false;

    for (const side of SIDES) {
      const frame = active ? sides[side] : null;
      const meter = s.sides[side];
      const m = meterFraction(frame?.momentary ?? -Infinity);
      const st = meterFraction(frame?.shortTerm ?? -Infinity);
      meter.bar = follow(meter.bar, m, dt, bar);
      meter.needle = follow(meter.needle, st, dt, needle);
      meter.hold = holdPeak(meter.hold, meter.bar, dt, {
        holdMs: HOLD.holdMs,
        // The tick lives in scale fractions: 8 LU over the 28 LU ruler.
        fallPerSecond: HOLD.fallPerSecond / 28,
      });
      meter.peak = holdPeak(
        meter.peak,
        frame?.peak ?? -Infinity,
        dt,
        PEAK_HOLD
      );
      if (meter.bar > 0.002 || meter.needle > 0.002 || meter.hold.value > 0.002)
        moving = true;
    }

    const shown = s.sides[audible];
    if (!reduced) {
      if (barRef.current)
        barRef.current.style.transform = `scaleX(${shown.bar})`;
      if (holdRef.current)
        holdRef.current.style.transform = `translateX(${shown.hold.value * 100}%)`;
      if (needleRef.current)
        needleRef.current.style.transform = `translateX(${shown.needle * 100}%)`;
      if (other && otherNeedleRef.current)
        otherNeedleRef.current.style.transform = `translateX(${s.sides[other].needle * 100}%)`;
    }

    s.sinceText += dt;
    if (active && s.sinceText >= READOUT_MS) {
      s.sinceText = 0;
      const frame = sides[audible];
      if (momentaryRef.current)
        momentaryRef.current.textContent = figure(
          frame?.momentary ?? -Infinity,
          format
        );
      if (shortTermRef.current)
        shortTermRef.current.textContent = figure(
          frame?.shortTerm ?? -Infinity,
          format
        );
      if (peakRef.current)
        peakRef.current.textContent = Number.isFinite(shown.peak.value)
          ? formatSignedDecimal(Math.min(0, shown.peak.value))
          : "—";
    }

    return moving;
  });

  const layer = (
    <span
      aria-hidden
      data-live={live ? "" : undefined}
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden opacity-0 motion-settle",
        "data-live:opacity-100",
        reduced && "hidden"
      )}
    >
      {/* Transforms only: the bar scales from the floor, the markers ride
          full-width tracks translated by the level, so nothing reflows. */}
      <i
        ref={barRef}
        className="absolute inset-x-0 bottom-px h-[3px] origin-left bg-art/70"
        style={AT_FLOOR}
      />
      <i ref={holdRef} className="absolute inset-0" style={AT_START}>
        <span className="absolute bottom-px left-0 h-[7px] w-px -translate-x-1/2 bg-ink" />
      </i>
      {comparing && (
        <i ref={otherNeedleRef} className="absolute inset-0" style={AT_START}>
          <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-ink/30" />
        </i>
      )}
      <i ref={needleRef} className="absolute inset-0" style={AT_START}>
        <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-ink" />
        <span className="absolute top-0 left-0 size-[5px] -translate-x-1/2 rounded-full bg-ink" />
      </i>
    </span>
  );

  return (
    <div ref={rootRef} className={className}>
      {/* The figures head the meter rather than trail it, so they sit with
          the ruler they read and never beside whatever follows the block.
          The row opens in height rather than appearing, so what sits below
          glides down when playback starts instead of jumping. */}
      <div
        aria-hidden
        data-live={live ? "" : undefined}
        className={cn(
          "grid grid-rows-[0fr] opacity-0 motion-settle",
          // Collapsed, the row is still in the DOM: nothing in it may take a
          // pointer until it is open, or an unseen label would answer a hover.
          "pointer-events-none data-live:pointer-events-auto",
          "data-live:grid-rows-[1fr] data-live:opacity-100"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "mb-2.5 flex items-baseline gap-x-3 font-mono text-micro whitespace-nowrap tabular-nums",
              tone === "art" ? "on-art-soft" : "text-ink-soft"
            )}
          >
            {caption && (
              <LabCaption
                caption={caption}
                afterLab={audible === "mix"}
                className="mr-auto"
              />
            )}
            {comparing && (
              <span className={cn(LABEL, "text-ink")}>
                {audible.toUpperCase()}
              </span>
            )}
            <span>
              <LoudnessUnit unit="M" compact className={LABEL} />{" "}
              <span ref={momentaryRef} className="text-ink">
                —
              </span>
            </span>
            <span>
              <LoudnessUnit unit="S" compact className={LABEL} />{" "}
              <span ref={shortTermRef} className="text-ink">
                —
              </span>
            </span>
            <span className={caption ? undefined : "ml-auto"}>
              <span className={LABEL}>Peak</span>{" "}
              <span ref={peakRef} className="text-ink">
                —
              </span>{" "}
              dB
            </span>
          </div>
        </div>
      </div>
      <LoudnessScale
        marks={marks}
        reference={loudnessReferenceLufs}
        band={band}
        pointer={pointer}
        label={label}
        tone={tone}
        live={layer}
        format={format}
      />
    </div>
  );
}
