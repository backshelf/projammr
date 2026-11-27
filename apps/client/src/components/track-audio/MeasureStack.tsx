"use client";

import { ChangeStrip } from "@/components/track-audio/ChangeStrip";
import { LoudnessStrip } from "@/components/track-audio/LoudnessStrip";
import { SpectrogramStrip } from "@/components/track-audio/SpectrogramStrip";
import {
  STRIP_EXPLAINERS,
  STRIP_IDS,
  STRIP_LABELS,
  type StripId,
} from "@/components/track-audio/strip-legend";
import {
  useTrackAudioDiff,
  useTrackAudioMeasure,
} from "@/components/track-audio/measures";
import { useProgressFrames } from "@/components/music-player/player-hooks";
import { useRef, useState } from "react";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/** Compact labels for the phone single-strip switcher so all three fit on one line. */
const PHONE_STRIP_LABELS: Readonly<Record<StripId, string>> = {
  loudness: "Loudness",
  spectrogram: "Spectrum",
  change: "Changes",
};

/** A chart legend rather than a row of switches: a pressed pill stays quiet
 *  and says it is on with a filled swatch of the colour the strips draw in,
 *  so three strips on do not put three filled pills under the waveform. */
const LEGEND_PILL =
  "data-pressed:border-rule-strong data-pressed:bg-transparent data-pressed:text-ink hover:data-pressed:border-ink-faint";
const LEGEND_SWATCH =
  "size-1.5 rounded-full border border-ink-faint motion-ink group-data-pressed/legend:border-art group-data-pressed/legend:bg-art";

/**
 * One legend pill: a `TogglePill` wrapped in a `Tooltip` that names what the
 * strip draws, in plain language, on hover or keyboard focus — the pill's own
 * label stays the accessible name, since `TooltipTrigger asChild` composes
 * the tooltip's listeners onto the pill rather than replacing it.
 */
function StripPill({
  id,
  pressed,
  onPressedChange,
}: {
  id: StripId;
  pressed: boolean;
  onPressedChange: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TogglePill
          pressed={pressed}
          onPressedChange={onPressedChange}
          className={cn("group/legend", LEGEND_PILL)}
        >
          <i aria-hidden className={LEGEND_SWATCH} />
          {STRIP_LABELS[id]}
        </TogglePill>
      </TooltipTrigger>
      <TooltipContent>{STRIP_EXPLAINERS[id]}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The strips under the waveform: a legend of `TogglePill`s choosing which
 * measurements to show (persisted per visitor), then one captioned row per
 * choice, sharing the waveform's own bar grid and click-to-seek gesture.
 *
 * Each strip's measure is asked for only while its pill is on: the
 * `trackAudioId` a hook receives is null otherwise, and a null id fetches
 * nothing (`components/track-audio/measures.ts`). Toggling a pill on or off
 * only re-renders this stack, never the waveform beside it.
 *
 * Renders as a `grid-cols-subgrid` spanning both of its parent's columns —
 * `TrackAudioSection`'s `[auto_minmax(0,1fr)]` grid, the same one the play
 * affordance and the waveform sit in — so every `StripRow`'s label and seek
 * surface share that grid's column widths down another subgrid level.
 */
export function MeasureStack({
  trackAudioId,
  previousAudioId,
  durationSeconds,
  spectrogramKey,
  selectedIds,
  onToggle,
  getSeconds,
  onSeek,
  live,
}: {
  /** Whether the player is on this version, so the strips carry its
   *  playhead; a version that is not playing shows none. */
  live: boolean;
  trackAudioId: number;
  /** The version the consecutive change map compares against; null with no
   *  earlier version to diff against. */
  previousAudioId: number | null;
  durationSeconds: number;
  spectrogramKey: string | null;
  selectedIds: readonly StripId[];
  onToggle: (id: StripId) => void;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
}) {
  const has = (id: StripId) => selectedIds.includes(id);
  const isPhone = useIsMobile();
  const [phoneStrip, setPhoneStrip] = useState<StripId | null>(null);

  const availableStrips = STRIP_IDS.filter((id) => {
    if (id === "spectrogram") return spectrogramKey !== null;
    if (id === "change") return previousAudioId !== null;
    return true;
  });

  // On phones, keep vertical stack compact: Waveform + 1 active analysis strip
  // chosen via a local segmented switcher, without overwriting the viewer's
  // desktop multi-strip preference.
  const phoneSingleStrip = isPhone && selectedIds.length > 0;
  const activePhoneStrip: StripId | null = !phoneSingleStrip
    ? null
    : phoneStrip !== null && availableStrips.includes(phoneStrip)
      ? phoneStrip
      : (availableStrips.find((id) => has(id)) ?? availableStrips[0] ?? null);

  const show = (id: StripId) =>
    phoneSingleStrip ? activePhoneStrip === id : has(id);

  // One playhead through every strip: the position is written to the stack
  // as a fraction, and each strip's line reads it, so a frame costs one
  // style write however many strips are on.
  const stackRef = useRef<HTMLDivElement>(null);
  useProgressFrames((seconds) => {
    const stack = stackRef.current;
    if (!stack) return;
    const fraction =
      live && durationSeconds > 0
        ? Math.max(0, Math.min(1, seconds / durationSeconds)).toFixed(4)
        : "0";
    if (stack.style.getPropertyValue("--playhead") !== fraction)
      stack.style.setProperty("--playhead", fraction);
  });

  const loudnessCurve = useTrackAudioMeasure<(number | null)[]>(
    show("loudness") ? trackAudioId : null,
    "loudnessCurve"
  );
  const diff = useTrackAudioDiff(
    show("change") ? previousAudioId : null,
    show("change") ? trackAudioId : null
  );

  return (
    <div
      ref={stackRef}
      data-live={live ? "" : undefined}
      className="group/strips col-span-2 mt-2 grid grid-cols-subgrid"
    >
      {phoneSingleStrip ? (
        availableStrips.length > 1 && activePhoneStrip !== null ? (
          <div className="col-span-2 pb-2">
            <SegmentedPill
              aria-label="Analysis strip"
              options={availableStrips.map((id) => ({
                value: id,
                label: PHONE_STRIP_LABELS[id],
              }))}
              value={activePhoneStrip}
              onValueChange={setPhoneStrip}
            />
          </div>
        ) : null
      ) : (
        <div
          className="col-span-2 flex flex-wrap gap-1.5 pb-2"
          role="group"
          aria-label="Strips"
        >
          {STRIP_IDS.map((id) => (
            <StripPill
              key={id}
              id={id}
              pressed={has(id)}
              onPressedChange={() => onToggle(id)}
            />
          ))}
        </div>
      )}
      {show("loudness") && loudnessCurve && (
        <LoudnessStrip
          curve={loudnessCurve}
          durationSeconds={durationSeconds}
          getSeconds={getSeconds}
          onSeek={onSeek}
        />
      )}
      {show("spectrogram") && spectrogramKey && (
        <SpectrogramStrip
          spectrogramKey={spectrogramKey}
          durationSeconds={durationSeconds}
          getSeconds={getSeconds}
          onSeek={onSeek}
        />
      )}
      {show("change") && diff && (
        <ChangeStrip
          change={diff.change}
          summary={diff.summary}
          durationSeconds={durationSeconds}
          getSeconds={getSeconds}
          onSeek={onSeek}
        />
      )}
    </div>
  );
}
