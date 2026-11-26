"use client";

import { belongsTo, type PlaybackOwner } from "@/components/art/playing-light";
import { LabCaption } from "@/components/loudness/LabCaption";
import {
  useAnalysis,
  useAudibleSide,
  useComparedSide,
  useCurrentTrack,
  useIsPlaying,
} from "@/components/music-player/player-hooks";
import { curvePath } from "@/components/spectrum/spectrum-geometry";
import {
  SpectrumScale,
  type SpectrumSize,
  type SpectrumBand,
  type SpectrumCurve,
} from "@/components/spectrum/SpectrumScale";
import { useSpectrumFrames } from "@/components/spectrum/use-spectrum-frames";
import type { Sides } from "@/components/music-player/use-side-frames";
import { follow, scaledBallistics } from "@/lib/meter-ballistics";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { SPECTRUM_LAYOUT, spectrumBandCentres } from "@workspace/dsp/spectrum";
import { useInView, useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { useRef } from "react";

/** A band rises within a couple of frames and falls over a third of a second, like the needle. */
const LINE = { attackMs: 40, releaseMs: 320 };
/** Below this many dB above the floor a settled line is treated as gone. */
const SETTLED_DB = 0.5;

const SIDES = ["a", "b", "mix"] as const;

/** The band centres the live meter reports; the drawing takes its x from these. */
const LIVE_HZ = spectrumBandCentres(SPECTRUM_LAYOUT);

/**
 * {@link SpectrumScale} with the playing audio's spectrum running over it,
 * while the audio belongs to `owner`: one ink line following the live level
 * per band, on the same window the stored curves are drawn on, so a version's
 * long-term average and what is sounding right now read against each other.
 *
 * During an A/B comparison both sources are metered: the audible one draws in
 * ink, the other faintly, the way the loudness needles do. While the Lab
 * plays without a comparison, the line reads the Lab's output, and a
 * captioned meter says so.
 *
 * The line is written straight to the DOM from one frame loop; React renders
 * only when the meter comes on or goes off. The loop also rests while the
 * block is scrolled out of the rail, and stops on its own once every band has
 * fallen to the floor. Under reduced motion the line is hidden and nothing is
 * written.
 */
export function LiveSpectrumScale({
  owner,
  curves,
  envelope,
  window,
  label,
  caption,
  tone = "paper",
  size,
  className,
}: {
  size?: SpectrumSize;
  owner: PlaybackOwner | "any";
  curves: SpectrumCurve[];
  envelope?: SpectrumBand;
  window: readonly [number, number];
  label: string;
  /** Names the meter on a surface where nothing else does. */
  caption?: string;
  tone?: "paper" | "art";
  className?: string;
}) {
  const current = useCurrentTrack();
  const isPlaying = useIsPlaying();
  const audible = useAudibleSide();
  const other = useComparedSide();
  const reduced = useReducedMotion();
  const line = scaledBallistics(LINE, useVisualsPolicy().meterBallistics);

  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);

  const mine = owner === "any" ? current != null : belongsTo(current, owner);
  const live = mine && isPlaying && inView;
  const comparing = live && other != null;

  useAnalysis(live);

  const audibleRef = useRef<SVGPathElement>(null);
  const otherRef = useRef<SVGPathElement>(null);

  const levelsRef = useRef<Sides<Float32Array>>({
    a: null,
    b: null,
    mix: null,
  });

  useSpectrumFrames(live, (sides, dt, active) => {
    const [floor] = window;
    let moving = false;

    for (const side of SIDES) {
      const frame = active ? sides[side] : null;
      const level = (levelsRef.current[side] ??= new Float32Array(
        LIVE_HZ.length
      ).fill(floor));
      for (let b = 0; b < level.length; b++) {
        const target = frame ? (frame[b] ?? floor) : floor;
        level[b] = follow(level[b]!, target, dt, line);
        if (level[b]! > floor + SETTLED_DB) moving = true;
      }
    }

    if (!reduced) {
      const shown = levelsRef.current[audible];
      const behind = other ? levelsRef.current[other] : null;
      if (shown && audibleRef.current)
        audibleRef.current.setAttribute("d", curvePath(LIVE_HZ, shown, window));
      if (comparing && behind && otherRef.current)
        otherRef.current.setAttribute("d", curvePath(LIVE_HZ, behind, window));
    }

    return moving;
  });

  const layer = (
    <g
      data-live={live ? "" : undefined}
      fill="none"
      className={cn(
        "opacity-0 motion-settle data-live:opacity-100",
        reduced && "hidden"
      )}
    >
      {comparing && (
        <path
          ref={otherRef}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-ink/30"
        />
      )}
      <path
        ref={audibleRef}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-ink"
      />
    </g>
  );

  return (
    <div ref={ref} className={className}>
      {/* The caption heads the meter rather than trailing it, and the row
          opens in height rather than appearing, so both meters on a surface
          come on the same way and what sits below glides down. */}
      {caption && (
        <div
          aria-hidden
          data-live={live ? "" : undefined}
          className={cn(
            "grid grid-rows-[0fr] opacity-0 motion-settle",
            "data-live:grid-rows-[1fr] data-live:opacity-100"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={cn(
                "mb-2.5 flex items-baseline gap-x-3 font-mono text-micro whitespace-nowrap",
                tone === "art" ? "on-art-soft" : "text-ink-soft"
              )}
            >
              <LabCaption
                caption={caption}
                afterLab={audible === "mix"}
                className="mr-auto"
              />
            </div>
          </div>
        </div>
      )}
      <SpectrumScale
        curves={curves}
        envelope={envelope}
        window={window}
        label={label}
        tone={tone}
        size={size}
        live={layer}
      />
    </div>
  );
}
