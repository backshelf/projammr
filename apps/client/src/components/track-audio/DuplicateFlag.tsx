import { duplicateFlagLabel } from "@/components/track-audio/version-rows";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

/**
 * "same audio as v3" — worn by a version row or the masthead's version
 * trigger when the row's `duplicateOfId` names another current version of
 * the same track.
 */
export function DuplicateFlag({
  version,
  className,
}: {
  version: number;
  className?: string;
}) {
  return (
    <StatusChip
      flag
      colour="var(--ink-soft)"
      className={cn("tabular-nums", className)}
    >
      {duplicateFlagLabel(version)}
    </StatusChip>
  );
}
