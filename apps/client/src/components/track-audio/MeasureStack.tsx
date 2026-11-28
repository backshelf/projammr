"use client";

import {
  useProgressFrames,
  writeAttribute,
} from "@/components/music-player/player-hooks";
import { ChangeStrip } from "@/components/track-audio/ChangeStrip";
import { LoudnessStrip } from "@/components/track-audio/LoudnessStrip";
import { SpectrogramStrip } from "@/components/track-audio/SpectrogramStrip";
import {
  PlayheadRegistryContext,
  type PlayheadTarget,
} from "@/components/track-audio/StripRow";
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
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useRef, useState } from "react";

/** Compact labels for the phone single-strip switcher so all three fit on one line. */
const PHONE_STRIP_LABELS: Readonly<Record<StripId, string>> = {
  loudness: "Loudness",
  spectrogram: "Spectrogram",
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
  label = STRIP_LABELS[id],
  pressed,
  onPressedChange,
}: {
  id: StripId;
  label?: string;
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
          {label}
        </TogglePill>
      </TooltipTrigger>
      <TooltipContent>{STRIP_EXPLAINERS[id]}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The strips under the waveform: a legend of `TogglePill`s choosing which
 * measurements to show (persisted per visitor), then one captioned row per
 * choice, sharing the waveform's `px-2`-aligned timeline and scrubbing.
 *
 * Playhead updates write `transform` directly on each strip's registered `<i>`
 * node so 60fps playback triggers zero subtree CSS variable recalculation.
 */
export function MeasureStack({
  trackAudioId,
  previousAudioId,
  previousVersion = null,
  durationSeconds,
  spectrogramKey,
  selectedIds,
  onToggle,
  onClear,
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
  previousVersion?: number | null;
  durationSeconds: number;
  spectrogramKey: string | null;
  selectedIds: readonly StripId[];
  onToggle: (id: StripId) => void;
  onClear?: () => void;
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

  // On phones, keep vertical stack compact: at most 1 active strip visible at
  // a time, while still allowing deselecting back to `[]` even with 1 strip.
  const activePhoneStrip: StripId | null =
    !isPhone || selectedIds.length === 0
      ? null
      : phoneStrip !== null && availableStrips.includes(phoneStrip)
        ? phoneStrip
        : (availableStrips.find((id) => has(id)) ?? availableStrips[0] ?? null);

  const show = (id: StripId) => (isPhone ? activePhoneStrip === id : has(id));

  const handlePhonePress = (id: StripId) => {
    if (activePhoneStrip === id) {
      setPhoneStrip(null);
      if (onClear) {
        onClear();
      } else {
        for (const selected of selectedIds) onToggle(selected);
      }
      return;
    }
    if (selectedIds.length === 0) {
      onToggle(id);
    }
    setPhoneStrip(id);
  };

  // Direct-transform playhead writes onto registered strip `<i>` elements
  // without setting an inherited `--playhead` CSS custom property on the stack.
  const playheadsRef = useRef(new Set<PlayheadTarget>());
  const lastSecondsRef = useRef(0);

  const applyPlayhead = useCallback(
    (target: PlayheadTarget, seconds: number) => {
      const fraction =
        live && durationSeconds > 0
          ? Math.max(0, Math.min(1, seconds / durationSeconds))
          : 0;
      const transform = `translateX(${(fraction * 100).toFixed(4)}%)`;
      if (target.playhead.style.transform !== transform) {
        target.playhead.style.transform = transform;
      }
      const opacity = live ? "1" : "0";
      if (target.playhead.style.opacity !== opacity) {
        target.playhead.style.opacity = opacity;
      }
      writeAttribute(
        target.slider,
        "aria-valuenow",
        String(Math.round(seconds))
      );
    },
    [live, durationSeconds]
  );

  const registerPlayhead = useCallback(
    (target: PlayheadTarget) => {
      playheadsRef.current.add(target);
      applyPlayhead(target, lastSecondsRef.current);
      return () => {
        playheadsRef.current.delete(target);
      };
    },
    [applyPlayhead]
  );

  useProgressFrames((seconds) => {
    lastSecondsRef.current = seconds;
    for (const target of playheadsRef.current) {
      applyPlayhead(target, seconds);
    }
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
    <PlayheadRegistryContext value={registerPlayhead}>
      <div className="mt-2 flex flex-col">
        {isPhone ? (
          availableStrips.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5 px-2 pb-2"
              role="group"
              aria-label="Analysis strip"
            >
              {availableStrips.map((id) => (
                <StripPill
                  key={id}
                  id={id}
                  label={PHONE_STRIP_LABELS[id]}
                  pressed={activePhoneStrip === id}
                  onPressedChange={() => handlePhonePress(id)}
                />
              ))}
            </div>
          )
        ) : (
          <div
            className="flex flex-wrap gap-1.5 px-2 pb-2"
            role="group"
            aria-label="Strips"
          >
            {availableStrips.map((id) => (
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
            trackAudioId={trackAudioId}
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
            vsVersion={previousVersion}
            aligned={diff.aligned}
            offsetMs={diff.offsetMs}
            change={diff.change}
            loudnessDelta={diff.loudnessDelta}
            summary={diff.summary}
            durationSeconds={durationSeconds}
            getSeconds={getSeconds}
            onSeek={onSeek}
          />
        )}
      </div>
    </PlayheadRegistryContext>
  );
}
