"use client";

import { EQ_FILTER_ITEMS, isPassFilter } from "@/components/lab/eq-bands";
import { RACK_VALUE_WIDTH } from "@/components/lab/rack-columns";
import { paramRange } from "@/lib/dsp/lab-settings";
import type { EqBand, EqFilter } from "@/lib/dsp/lab-settings";
import { Param } from "@workspace/dsp/params";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

// Every band shares one domain, so band 1's entry stands for all eight.
const HZ_RANGE = paramRange(Param.Eq1Hz);
const GAIN_RANGE = paramRange(Param.Eq1GainDb);
const Q_RANGE = paramRange(Param.Eq1Q);

const FIELD = "text-micro fine:h-6 coarse:h-11";

/** One band, for the keyboard route to the same values the curve's handles
 *  set by drag: filter, frequency, gain and Q as plain fields. Choosing
 *  "Off" frees the slot, and the row leaves the list. */
export function RackBand({
  index,
  band,
  onChange,
  disabled,
}: {
  index: number;
  band: EqBand;
  onChange: (patch: Partial<EqBand>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(LABEL, "w-4 shrink-0 text-center text-ink-faint")}
        aria-hidden
      >
        {index + 1}
      </span>
      <Select
        value={band.kind}
        items={EQ_FILTER_ITEMS}
        disabled={disabled}
        onValueChange={(kind) => onChange({ kind: kind as EqFilter })}
      >
        <SelectTrigger
          className={cn("min-w-0 flex-1", FIELD)}
          aria-label={`Band ${index + 1} filter`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EQ_FILTER_ITEMS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        aria-label={`Band ${index + 1} frequency in hertz`}
        className={cn("w-20 phone:w-16", FIELD)}
        value={Math.round(band.hz)}
        min={HZ_RANGE.min}
        max={HZ_RANGE.max}
        disabled={disabled}
        onChange={(e) => onChange({ hz: Number(e.target.value) })}
      />
      <Input
        type="number"
        aria-label={`Band ${index + 1} gain in decibels`}
        className={cn(RACK_VALUE_WIDTH, FIELD)}
        value={band.gainDb}
        step={0.5}
        min={GAIN_RANGE.min}
        max={GAIN_RANGE.max}
        disabled={disabled || isPassFilter(band.kind)}
        onChange={(e) => onChange({ gainDb: Number(e.target.value) })}
      />
      <Input
        type="number"
        aria-label={`Band ${index + 1} Q`}
        className={cn(RACK_VALUE_WIDTH, FIELD)}
        value={band.q}
        step={0.1}
        min={Q_RANGE.min}
        max={Q_RANGE.max}
        disabled={disabled}
        onChange={(e) => onChange({ q: Number(e.target.value) })}
      />
    </div>
  );
}
