"use client";

import {
  pitchFigure,
  preparingCopy,
  showsPitchSlider,
  showsSpeedSlider,
  slidersReady,
  speedFigure,
  unavailableCopy,
} from "@/components/lab/lab-view-model";
import {
  useCompare,
  useLab,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { RackSliderRow } from "@/components/lab/RackSliderRow";
import { ComparePhase } from "@/components/track-audio/AudioCompareControls";
import {
  DEFAULT_LAB,
  SPEED_STEP,
  type SpeedPitchMode,
} from "@/lib/dsp/lab-settings";
import { useLabPolicy } from "@/lib/policies/provider";
import { Button } from "@workspace/ui/components/button";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { Meter } from "@workspace/ui/components/table";

const MODE_OPTIONS: { value: SpeedPitchMode; label: string }[] = [
  { value: "speed", label: "Speed only" },
  { value: "pitch", label: "Pitch only" },
  { value: "linked", label: "Linked" },
  { value: "independent", label: "Independent" },
];

/**
 * The Lab's time-and-pitch controls: the mode, and whichever of the two
 * sliders that mode moves on its own. Replaces the speed popover the sheet's
 * secondary row used to carry, so speed, pitch and the mode live in one
 * place. While the Lab or a comparison prepares, or either has failed, a
 * Meter or a line of copy takes the sliders' place; the mode and Reset stay put, since they change a
 * setting rather than something that needs the Lab running to show.
 */
export function SpeedPitch() {
  const { settings, phase, fraction, reason, source } = useLab();
  const compare = useCompare();
  const comparePreparing = compare != null && compare.phase !== "ready";
  const { setLabMode, setSpeed, setPitch } = usePlayerActions();
  const { timePitchMode, speedRange, pitchRange } = useLabPolicy();
  const { mode, speed, pitch } = settings;

  const isDefault =
    mode === timePitchMode &&
    speed === DEFAULT_LAB.speed &&
    pitch === DEFAULT_LAB.pitch;

  const reset = () => {
    setLabMode(timePitchMode);
    setSpeed(DEFAULT_LAB.speed);
    setPitch(DEFAULT_LAB.pitch);
  };

  const preparing = preparingCopy({ source, fraction });
  const ready = slidersReady(phase);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedPill
          aria-label="Time and pitch mode"
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={setLabMode}
          className="max-w-full overflow-x-auto"
        />
        <Button variant="ghost" size="xs" onClick={reset} disabled={isDefault}>
          Reset
        </Button>
      </div>

      {comparePreparing ? (
        <ComparePhase comparing={compare} />
      ) : phase === "preparing" ? (
        <div className="flex flex-col gap-1.5">
          <Meter aria-label={preparing.label} value={preparing.percent} />
          <p className="text-micro text-ink-soft">{preparing.line}</p>
        </div>
      ) : phase === "unavailable" ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-micro font-medium text-ink">
            The Lab cannot open this file here
          </p>
          {reason && (
            <p className="text-micro text-ink-soft">
              {unavailableCopy({ reason })}
            </p>
          )}
        </div>
      ) : null}

      {ready && showsSpeedSlider(mode) && (
        <RackSliderRow
          label="Speed"
          aria-label="Speed"
          value={[speed]}
          onValueChange={([value]) => value !== undefined && setSpeed(value)}
          min={speedRange.min}
          max={speedRange.max}
          step={SPEED_STEP}
          display={speedFigure(speed)}
        />
      )}

      {ready && showsPitchSlider(mode) && (
        <RackSliderRow
          label="Pitch"
          aria-label="Pitch"
          value={[pitch]}
          onValueChange={([value]) => value !== undefined && setPitch(value)}
          min={pitchRange.min}
          max={pitchRange.max}
          step={1}
          display={pitchFigure(pitch)}
        />
      )}
    </div>
  );
}
