import type { GetSession } from "@workspace/api/api";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The masthead's flag while a machine has the set open: "Open in Live on
 * Studio Mac". Nothing when no machine does.
 */
export function OpenInLiveFlag({
  openOn,
  className,
}: {
  openOn: GetSession["openOn"];
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
      Open in Live on {openOn.machine}
    </StatusChip>
  );
}
