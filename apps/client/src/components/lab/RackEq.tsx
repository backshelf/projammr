"use client";

import { activeBandIndices, freeBandIndex } from "@/components/lab/eq-bands";
import {
  EQ_DRAWING_SIZE,
  EqCurveOverlay,
} from "@/components/lab/EqCurveOverlay";
import { RackBand } from "@/components/lab/RackBand";
import { RackModule } from "@/components/lab/RackModule";
import { LiveSpectrumScale } from "@/components/spectrum/LiveSpectrumScale";
import type { SpectrumCurve } from "@/components/spectrum/SpectrumScale";
import { spectrumWindow, type Spectrum } from "@workspace/dsp/spectrum";
import {
  useCurrentTrack,
  useLabSettings,
  usePlayerActions,
} from "@/components/music-player/player-hooks";
import { trackLabel } from "@/components/music-player/types";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { IconChevronRight, IconPlus } from "@tabler/icons-react";
import { HeightReveal } from "@workspace/ui/components/height-reveal";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

/**
 * The Lab's parametric EQ: eight biquad slots, drawn as one response curve
 * over the live spectrum with a draggable, numbered handle per active band.
 * The curve is the control; the same values as typed fields fold away under
 * "Bands", listing only the slots in use, with a way to bring another in.
 */
export function RackEq() {
  const current = useCurrentTrack();
  const stored = useTrackAudioMeasure<Spectrum>(
    current?.trackAudio?.id ?? null,
    "spectrum"
  );
  const curves: SpectrumCurve[] =
    stored && current
      ? [
          {
            ...stored,
            label: current.trackAudio
              ? `v${current.trackAudio.version}`
              : trackLabel(current),
            emphasis: "selected",
          },
        ]
      : [];
  const { rack } = useLabSettings();
  const { setEqOn, setEqBand } = usePlayerActions();
  const { on, bands } = rack.eq;
  const [listOpen, setListOpen] = useState(false);

  const active = activeBandIndices(bands);
  const free = freeBandIndex(bands);

  return (
    <RackModule label="EQ" on={on} onChange={setEqOn}>
      <div className="relative">
        <LiveSpectrumScale
          owner="any"
          size={EQ_DRAWING_SIZE}
          curves={curves}
          window={spectrumWindow(curves.map((curve) => curve.db))}
          label={
            stored
              ? "Live spectrum with stored average and EQ response"
              : "Live spectrum with the EQ's response"
          }
        />
        <EqCurveOverlay
          bands={bands}
          onChangeBand={(index, patch) => setEqBand(index, patch)}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen((open) => !open)}
          className={cn(
            LABEL,
            "group flex cursor-pointer items-center gap-1 text-ink-soft motion-ink hover:text-ink coarse:min-h-11"
          )}
        >
          <IconChevronRight
            aria-hidden
            className="size-3 motion-move group-aria-expanded:rotate-90"
          />
          Bands
          <span className="text-ink-faint tabular-nums">{active.length}</span>
        </button>
        {free != null && (
          <button
            type="button"
            onClick={() => {
              setEqBand(free, { kind: "peaking", gainDb: 0 });
              setListOpen(true);
            }}
            className="flex cursor-pointer items-center gap-1 text-micro text-art hover:underline coarse:min-h-11"
          >
            <IconPlus aria-hidden className="size-3" />
            Add band
          </button>
        )}
      </div>

      <HeightReveal open={listOpen}>
        <div className="flex flex-col gap-1.5 pb-1">
          {active.length === 0 ? (
            <p className="text-micro text-ink-faint">
              Every band is off, so the EQ passes the sound through.
            </p>
          ) : (
            active.map((index) => (
              <RackBand
                key={index}
                index={index}
                band={bands[index]!}
                onChange={(patch) => setEqBand(index, patch)}
              />
            ))
          )}
        </div>
      </HeightReveal>
    </RackModule>
  );
}
