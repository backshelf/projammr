"use client";

import {
  DEVICE_DESCRIPTIONS,
  DEVICE_LABEL,
} from "@/components/lab/device-copy";
import { normaliseAvailable } from "@/components/lab/lab-view-model";
import { RACK_LABEL_WIDTH } from "@/components/lab/rack-columns";
import {
  useLabSettings,
  useLabTarget,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import {
  BAND_LABELS,
  LAB_AUDITIONS,
  labAudition,
  type LabAudition,
  type LabAuditionKey,
} from "@/lib/dsp/lab-auditions";
import type { BandKey, DeviceKey } from "@/lib/dsp/lab-settings";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** The stereo and device rows read the registry's canonical labels, except
 *  the two single-letter stereo pills the row has no room to spell out. */
const PILL_LABEL: Partial<Record<LabAuditionKey, string>> = {
  left: "L",
  right: "R",
};
const pillLabel = (audition: LabAudition) =>
  PILL_LABEL[audition.key] ?? audition.label;

const STEREO_OPTIONS = LAB_AUDITIONS.filter((a) => a.group === "stereo");
const DEVICE_OPTIONS = LAB_AUDITIONS.filter((a) => a.group === "device");

const BAND_OPTIONS: { value: BandKey; label: string }[] = (
  Object.keys(BAND_LABELS) as BandKey[]
).map((value) => ({ value, label: BAND_LABELS[value] }));

/** One labelled row of pills, its label in the rack's own label column so
 *  the auditions line up with the sliders above them. */
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start gap-3">
    <span
      className={cn(
        LABEL,
        RACK_LABEL_WIDTH,
        "shrink-0 pt-1.5 text-ink-soft coarse:pt-4"
      )}
    >
      {label}
    </span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {children}
    </div>
  </div>
);

/**
 * How to hear the version differently, without changing the file, in four
 * labelled rows: the stereo image (collapse, one side, polarity), how it is
 * monitored (crossfeed, a −20 dB dim, loudness normalisation), a band solo,
 * and a device's frequency impression. Every pill is a single click and
 * shows its own state; the mutually exclusive choices (stereo mode, device)
 * return to their rest state when the pressed pill is pressed again.
 */
export function Auditions({ lufs }: { lufs: number | null }) {
  const { auditions } = useLabSettings();
  const { setAudition } = usePlayerActions();

  const toggle = (audition: LabAudition, pressed: boolean) =>
    setAudition(audition.set(pressed));
  const dim = labAudition("dim");
  const crossfeed = labAudition("crossfeed");
  const normalise = labAudition("normalise");
  const normaliseTargetLufs = useLabTarget();

  return (
    <div className="flex flex-col gap-2.5">
      <Row label="Stereo">
        {STEREO_OPTIONS.map((audition) => (
          <TogglePill
            key={audition.key}
            pressed={audition.isOn(auditions)}
            onPressedChange={(pressed) => toggle(audition, pressed)}
          >
            {pillLabel(audition)}
          </TogglePill>
        ))}
        <TogglePill
          pressed={auditions.polarityRight}
          aria-label="Flip the right channel's polarity"
          onPressedChange={(next) => setAudition({ polarityRight: next })}
        >
          Ø R
        </TogglePill>
      </Row>

      <Row label="Monitor">
        <TogglePill
          pressed={crossfeed.isOn(auditions)}
          onPressedChange={(pressed) => toggle(crossfeed, pressed)}
        >
          Crossfeed
        </TogglePill>
        <TogglePill
          pressed={dim.isOn(auditions)}
          onPressedChange={(pressed) => toggle(dim, pressed)}
        >
          Dim −20
        </TogglePill>
        <TogglePill
          pressed={normalise.isOn(auditions)}
          disabled={!normaliseAvailable(lufs)}
          title={
            normaliseAvailable(lufs)
              ? undefined
              : "This version has no loudness figure yet"
          }
          onPressedChange={(pressed) => toggle(normalise, pressed)}
        >
          {normalise.labelFor({ normaliseTargetLufs })}
        </TogglePill>
      </Row>

      <Row label="Bands">
        {BAND_OPTIONS.map((option) => (
          <TogglePill
            key={option.value}
            pressed={auditions.bands.includes(option.value)}
            onPressedChange={(pressed) =>
              setAudition({
                bands: pressed
                  ? [...auditions.bands, option.value]
                  : auditions.bands.filter((band) => band !== option.value),
              })
            }
          >
            {option.label}
          </TogglePill>
        ))}
      </Row>

      <Row label="Device">
        {DEVICE_OPTIONS.map((audition) => (
          <Tooltip key={audition.key}>
            <TooltipTrigger asChild>
              <TogglePill
                pressed={audition.isOn(auditions)}
                onPressedChange={(pressed) => toggle(audition, pressed)}
              >
                {pillLabel(audition)}
              </TogglePill>
            </TooltipTrigger>
            <TooltipContent>
              {/* DEVICE_OPTIONS is LAB_AUDITIONS filtered to group "device",
                  so every key here is a DeviceKey. */}
              {DEVICE_DESCRIPTIONS[audition.key as DeviceKey]}
            </TooltipContent>
          </Tooltip>
        ))}
        {auditions.device && (
          <span className="basis-full text-micro text-ink-faint">
            An impression of {DEVICE_LABEL[auditions.device]}
          </span>
        )}
      </Row>
    </div>
  );
}
