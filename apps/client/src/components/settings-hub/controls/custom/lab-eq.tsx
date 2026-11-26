"use client";

import {
  EQ_DRAWING_SIZE,
  EqCurveOverlay,
} from "@/components/lab/EqCurveOverlay";
import { RackBand } from "@/components/lab/RackBand";
import { RACK_PILL_WIDTH } from "@/components/lab/rack-columns";
import { SPECTRUM_DRAWING_HEIGHT } from "@/components/spectrum/SpectrumScale";
import { DEFAULT_LAB, type EqBand } from "@/lib/dsp/lab-settings";
import {
  isRackDefault,
  RACK_DEFAULT,
  type RackDefault,
} from "@workspace/settings/groups/lab";
import { Button } from "@workspace/ui/components/button";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { cn } from "@workspace/ui/lib/utils";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

type EqValue = { on: boolean; bands: EqBand[] } | RackDefault;

/** The EQ a fresh browser's rack starts with: the rack default is the rack's
 *  own, shown as its values with a "Rack default" marker; the first edit
 *  writes the whole object with that one field changed, and Reset writes the
 *  rack default back. Every one of
 *  the fixed `EQ_BANDS` slots gets its own row, without the Rack's own
 *  live-spectrum drawing or its collapsed "Bands" list, and every band stays
 *  editable whatever `on` is, since setting a default is not running the
 *  rack. A custom control takes `value` as `unknown`; `lab.eqPreset`'s
 *  schema is what pairs it with this shape. */
export function LabEqControl({
  value: rawValue,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const value = rawValue as EqValue;
  const isDefault = isRackDefault(value);
  const effective = isDefault ? DEFAULT_LAB.rack.eq : value;
  const patch = (next: Partial<{ on: boolean; bands: EqBand[] }>) =>
    onChange({ ...effective, ...next });
  const patchBand = (index: number, bandPatch: Partial<EqBand>) =>
    patch({
      bands: effective.bands.map((band, at) =>
        at === index ? { ...band, ...bandPatch } : band
      ),
    });

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-80 flex-col gap-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <TogglePill
          pressed={effective.on}
          onPressedChange={(next) => patch({ on: next })}
          disabled={disabled}
          className={RACK_PILL_WIDTH}
        >
          EQ
        </TogglePill>
        {isDefault ? (
          <span className="text-micro text-ink-faint">Rack default</span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onChange(RACK_DEFAULT)}
          >
            Reset
          </Button>
        )}
      </div>
      <div className={cn("relative", SPECTRUM_DRAWING_HEIGHT[EQ_DRAWING_SIZE])}>
        <EqCurveOverlay
          bands={effective.bands}
          onChangeBand={patchBand}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {effective.bands.map((band, index) => (
          <RackBand
            // eslint-disable-next-line @eslint-react/no-array-index-key -- the index is the band's fixed slot (0..7), never reordered
            key={index}
            index={index}
            band={band}
            disabled={disabled}
            onChange={(bandPatch) => patchBand(index, bandPatch)}
          />
        ))}
      </div>
    </div>
  );
}
