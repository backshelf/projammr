"use client";

import { ROWS } from "@/components/lab/RackComp";
import { RackSliderRow } from "@/components/lab/RackSliderRow";
import { RACK_PILL_WIDTH } from "@/components/lab/rack-columns";
import {
  DEFAULT_LAB,
  paramRange,
  type CompSettings,
} from "@/lib/dsp/lab-settings";
import {
  isRackDefault,
  RACK_DEFAULT,
  type RackDefault,
} from "@workspace/settings/groups/lab";
import { Button } from "@workspace/ui/components/button";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

/** The compressor a fresh browser's rack starts with: the rack default is the
 *  rack's own, shown as its values with a "Rack default" marker; the first
 *  edit writes the whole object with that one field changed, and Reset writes
 *  the rack default back. Every field stays editable whatever `on` is, since
 *  setting a default is not running the rack. A custom control takes `value`
 *  as `unknown`; `lab.compressor`'s schema is what pairs it with
 *  `CompSettings`. */
export function LabCompressorControl({
  value: rawValue,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const value = rawValue as CompSettings | RackDefault;
  const isDefault = isRackDefault(value);
  const effective = isDefault ? DEFAULT_LAB.rack.comp : value;
  const patch = (next: Partial<CompSettings>) =>
    onChange({ ...effective, ...next });

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
          Comp
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
      {ROWS.map((row) => {
        const { min, max } = paramRange(row.param);
        const rowValue = effective[row.key];
        return (
          <RackSliderRow
            key={row.key}
            label={row.label}
            aria-label={row.label}
            disabled={disabled}
            value={[rowValue]}
            onValueChange={([next]) =>
              next !== undefined && patch({ [row.key]: next })
            }
            min={min}
            max={max}
            step={row.step}
            display={`${rowValue.toFixed(row.step < 1 ? 1 : 0)}${row.unit}`}
          />
        );
      })}
    </div>
  );
}
