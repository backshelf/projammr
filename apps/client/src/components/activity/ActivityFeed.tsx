import { getProjectActivity } from "@/actions/activity";
import { loadActivityVocabularies } from "@/components/activity/activity-vocabularies";
import { cachedFormatters } from "@/lib/formatters";
import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import type { Activity } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { ActivityList } from "./ActivityList";

/**
 * Recent activity, newest first. Scoped to one entity when `entityType` and
 * `entityId` are given, otherwise the whole project. Folded until opened: it
 * is the page's history, not its content. Renders nothing when there is no
 * recorded activity yet.
 */
export async function ActivityFeed({
  projectId,
  entityType,
  entityId,
  limit = 15,
}: {
  projectId: number;
  entityType?: Activity["entityType"];
  entityId?: number;
  limit?: number;
}) {
  const [result, format, vocabularies] = await Promise.all([
    getProjectActivity(projectId, { entityType, entityId, limit }),
    cachedFormatters(projectId),
    loadActivityVocabularies(projectId),
  ]);
  if (isActionError(result) || result.length === 0) return null;

  return (
    <Arrive>
      <CollapsibleSection label={"ACTIVITY"} defaultOpen={false}>
        <ActivityList
          rows={result}
          format={format}
          vocabularies={vocabularies}
        />
      </CollapsibleSection>
    </Arrive>
  );
}
