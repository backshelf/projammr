import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties } from "react";

/**
 * A track's colour as the DAW shows it, as a 6px square beside its name:
 * smaller than the artwork swatch beside a sidebar row, because a set lists
 * dozens of tracks where the sidebar lists a handful of songs. The colour is
 * the DAW's exact one, so a producer finds their drum bus by the colour they
 * gave it; a hairline ring holds the edge of a pale one on paper. A track the
 * DAW gave no colour keeps the square as an empty ring, so a column of
 * swatches stays a column.
 */
export function TrackSwatch({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-slot="track-swatch"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-[0.0625rem] bg-[var(--track,transparent)]",
        "shadow-[0_0_0_1px_color-mix(in_oklab,var(--ink)_14%,transparent)]",
        className
      )}
      style={color ? ({ "--track": color } as CSSProperties) : undefined}
    />
  );
}
