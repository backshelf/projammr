"use client";

import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

import {
  LOUDNESS_UNIT_COPY,
  type LoudnessUnitKind,
} from "./loudness-unit-copy";

// An inline box ignores `min-height`; the flex display under `coarse:` is what
// lets the 44px floor apply without moving the text.
const ABBR_CLASS =
  "underline decoration-ink-faint/40 decoration-dotted underline-offset-4 coarse:inline-flex coarse:min-h-11 coarse:items-center coarse:px-1 coarse:-mx-1";

// The same 44px target, taken out of the line box: the `::after` overlay grows
// over what sits above and below instead of setting the row's height.
const COMPACT_ABBR_CLASS =
  "underline decoration-ink-faint/40 decoration-dotted underline-offset-4 coarse:relative coarse:after:absolute coarse:after:inset-x-0 coarse:after:-inset-y-4 coarse:after:content-['']";

/**
 * A loudness unit ("LUFS", "TP") or live reading ("M", "S") as an `<abbr>`
 * explaining itself, so every reading that carries one gets the same
 * explanation without repeating it as caption text. A fine pointer opens the
 * explanation on hover or keyboard focus, in the app's root
 * `TooltipProvider`. A coarse pointer has no hover, so it gets a `Popover`
 * instead — the same `<abbr>` as its trigger, opened by a tap.
 */
export function LoudnessUnit({
  unit,
  compact = false,
  className,
}: {
  unit: LoudnessUnitKind;
  /**
   * For a readout row that is `aria-hidden` and collapses to nothing when it
   * goes quiet, such as the live meter's figures: the tap target grows over
   * its neighbours rather than setting the row's height, and the label stays
   * out of the tab order rather than becoming a tab stop into hidden content.
   */
  compact?: boolean;
  className?: string;
}) {
  const coarse = useCoarsePointer();
  const abbr = (
    <abbr
      tabIndex={compact ? undefined : 0}
      className={cn(compact ? COMPACT_ABBR_CLASS : ABBR_CLASS, className)}
    >
      {unit}
    </abbr>
  );

  if (coarse) {
    return (
      <Popover>
        <PopoverTrigger asChild>{abbr}</PopoverTrigger>
        <PopoverContent>{LOUDNESS_UNIT_COPY[unit]}</PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{abbr}</TooltipTrigger>
      <TooltipContent>{LOUDNESS_UNIT_COPY[unit]}</TooltipContent>
    </Tooltip>
  );
}
