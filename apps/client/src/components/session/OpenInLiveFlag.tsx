import type { GetSession } from "@workspace/api/api";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The masthead's flag while a machine has the set open: "Open in Ableton Live
 * on Studio Mac" (or "DAW" when the DAW name is unset). Nothing when no
 * machine has the set open.
 */
export function OpenInLiveFlag({
  openOn,
  dawName,
  className,
}: {
  openOn: GetSession["openOn"];
  dawName?: string | null;
  className?: string;
}) {
  if (openOn == null) return null;

  return (
    <StatusChip
      flag
      colour="var(--art)"
      title={`Opened by ${openOn.owner.name}`}
      className={cn("flex-none", className)}
    >
      Open in {dawName || "DAW"} on {openOn.machine}
    </StatusChip>
  );
}
