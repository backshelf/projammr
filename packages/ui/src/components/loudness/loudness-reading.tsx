import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * The headline figure of a loudness block: the LUFS value in the small
 * display face with its unit and qualifier set quietly beside it. A value
 * still being measured reads faint, so a partial figure never looks final.
 * `format` is the viewer's formatter set; a page with no viewer writes the
 * figure at the defaults.
 */
export function LoudnessReading({
  lufs,
  children,
  pending = false,
  format = defaultFormatters(),
}: {
  lufs: number;
  /** The unit and whatever qualifies the figure — "LUFS median", a true peak. */
  children: ReactNode;
  pending?: boolean;
  format?: Formatters;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className={cn(
          "font-display-clean text-section leading-none tabular-nums",
          pending ? "text-ink-soft" : "text-ink"
        )}
      >
        {format.lufs(lufs)}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-micro whitespace-nowrap text-ink-soft">
        {children}
      </span>
    </div>
  );
}
