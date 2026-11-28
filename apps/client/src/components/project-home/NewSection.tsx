import { saveEntries } from "@/components/work-heatmap/save-entries";
import { cachedFormatters } from "@/lib/formatters";
import type { ProjectToday } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { NewSaves } from "./NewSaves";
import { groupTodayRenders } from "./render-groups";
import { RenderRow } from "./RenderRow";
import { newWindowLabel } from "./today-copy";

/**
 * What landed in the project's new window: the track audio versions linked
 * (collapsed per track so repeated bounces read as `v3–v4`), then raw DAW
 * saves folded behind a producer disclosure. Renders nothing when the read
 * failed or nothing visible landed.
 */
export async function NewSection({
  projectId,
  today,
  canEdit = true,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
  canEdit?: boolean;
}) {
  const [result, format, settings] = await Promise.all([
    today,
    cachedFormatters(projectId),
    cachedEffectiveSettings(projectId),
  ]);
  if (isActionError(result)) return null;

  const groupedRenders = groupTodayRenders(result.renders);
  const showSaves = canEdit && result.saves.length > 0;
  if (groupedRenders.length === 0 && !showSaves) return null;
  const asOf = new Date();

  return (
    <Arrive>
      <section>
        <SectionHead
          count={newWindowLabel(
            settings.values["project-conventions.todayNewHours"]
          )}
        >
          NEW
        </SectionHead>
        {groupedRenders.length > 0 && (
          <Rows>
            {groupedRenders.map(({ latest, versionLabel }) => (
              <RenderRow
                key={latest.trackId}
                row={latest}
                projectId={projectId}
                versionLabel={versionLabel}
              />
            ))}
          </Rows>
        )}
        {showSaves && (
          <NewSaves
            entries={saveEntries(result.saves, projectId, format)}
            asOf={asOf}
          />
        )}
      </section>
    </Arrive>
  );
}
