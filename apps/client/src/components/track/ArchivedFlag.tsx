import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

/** The flag on an archived track, wherever the track is named. */
export function ArchivedFlag({ className }: { className?: string }) {
  return (
    <StatusChip
      flag
      colour="var(--ink-soft)"
      className={cn("flex-none", className)}
    >
      Archived
    </StatusChip>
  );
}
