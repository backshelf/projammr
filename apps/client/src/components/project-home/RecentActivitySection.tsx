import { getProjectActivity } from "@/actions/activity";
import { ActivityList } from "@/components/activity/ActivityList";
import { loadActivityVocabularies } from "@/components/activity/activity-vocabularies";
import { cachedFormatters } from "@/lib/formatters";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { SectionHead } from "@workspace/ui/components/layout/section-head";

/** The project's latest eight activity rows, open. Renders nothing when there is none. */
export async function RecentActivitySection({
  projectId,
}: {
  projectId: number;
}) {
  const [result, format, vocabularies] = await Promise.all([
    getProjectActivity(projectId, { limit: 8 }),
    cachedFormatters(projectId),
    loadActivityVocabularies(projectId),
  ]);
  if (isActionError(result) || result.length === 0) return null;

  return (
    <Arrive>
      <section>
        <SectionHead>ACTIVITY</SectionHead>
        <ActivityList
          rows={result}
          format={format}
          vocabularies={vocabularies}
        />
      </section>
    </Arrive>
  );
}
