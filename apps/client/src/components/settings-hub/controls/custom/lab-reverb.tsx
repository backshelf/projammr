"use client";

import { PRESETS } from "@/components/lab/RackReverb";
import { RackSliderRow } from "@/components/lab/RackSliderRow";
import { RACK_PILL_WIDTH } from "@/components/lab/rack-columns";
import {
  DEFAULT_LAB,
  paramRange,
  type ReverbSettings,
} from "@/lib/dsp/lab-settings";
import { Param } from "@workspace/dsp/params";
import {
  isRackDefault,
  RACK_DEFAULT,
  type RackDefault,
} from "@workspace/settings/groups/lab";
import { Button } from "@workspace/ui/components/button";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

/** The reverb a fresh browser's rack starts with: the rack default is the
 *  rack's own, shown as its values with a "Rack default" marker; the first
 *  edit writes the whole object with that one field changed, and Reset writes
 *  the rack default back. Every field stays editable whatever `on` is, since
 *  setting a default is not running the rack. A custom control takes `value`
 *  as `unknown`; `lab.reverb`'s schema is what pairs it with
 *  `ReverbSettings`. */
export function LabReverbControl({
  value: rawValue,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const value = rawValue as ReverbSettings | RackDefault;
  const isDefault = isRackDefault(value);
  const effective = isDefault ? DEFAULT_LAB.rack.reverb : value;
  const patch = (next: Partial<ReverbSettings>) =>
    onChange({ ...effective, ...next });
  const wetRange = paramRange(Param.ReverbWet);
  const preDelayRange = paramRange(Param.ReverbPreDelayMs);

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
          Verb
        </TogglePill>
        <SegmentedPill
          aria-label="Reverb preset"
          disabled={disabled}
          options={PRESETS}
          value={effective.preset}
          onValueChange={(preset) => patch({ preset })}
        />
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
      <RackSliderRow
        label="Wet"
        aria-label="Reverb amount"
        disabled={disabled}
        value={[effective.wet]}
        onValueChange={([next]) => next !== undefined && patch({ wet: next })}
        min={wetRange.min}
        max={wetRange.max}
        step={0.01}
        display={`${Math.round(effective.wet * 100)}%`}
      />
      <RackSliderRow
        label="Pre-delay"
        aria-label="Reverb pre-delay"
        disabled={disabled}
        value={[effective.preDelayMs]}
        onValueChange={([next]) =>
          next !== undefined && patch({ preDelayMs: next })
        }
        min={preDelayRange.min}
        max={preDelayRange.max}
        step={1}
        display={`${Math.round(effective.preDelayMs)} ms`}
      />
    </div>
  );
}
