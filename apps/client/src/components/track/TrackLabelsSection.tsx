import { RailLabel } from "@workspace/ui/components/layout/rail";
import { LabelsCell } from "@/components/tables/LabelsCell";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { Label } from "@workspace/api/api";

export function TrackLabelsSection({
  projectId,
  trackId,
  labels,
  projectLabels,
}: {
  projectId: number;
  trackId: number;
  labels: Label[];
  projectLabels: Label[];
}) {
  return (
    <div>
      <RailLabel>LABELS</RailLabel>
      <LabelsCell
        entityType="track"
        entityId={trackId}
        labels={labels}
        projectLabels={projectLabels}
        listHref={hrefFromParsedRoute({ kind: "track-all" }, projectId)}
      />
    </div>
  );
}
