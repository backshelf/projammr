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
import { RenderRow } from "./RenderRow";
import { newWindowLabel } from "./today-copy";

/**
 * What landed in the project's new window: the track audio versions linked, each playable
 * in place, then the session saves. Renders nothing when the read failed or
 * both are empty; with only one of them, only that part shows.
 */
export async function NewSection({
  projectId,
  today,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
}) {
  const [result, format, settings] = await Promise.all([
    today,
    cachedFormatters(projectId),
    cachedEffectiveSettings(projectId),
  ]);
  if (isActionError(result)) return null;

  const { renders, saves } = result;
  if (renders.length === 0 && saves.length === 0) return null;
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
        {renders.length > 0 && (
          <Rows>
            {renders.map((row) => (
              <RenderRow key={row.id} row={row} projectId={projectId} />
            ))}
          </Rows>
        )}
        {saves.length > 0 && (
          <NewSaves
            entries={saveEntries(saves, projectId, format)}
            asOf={asOf}
          />
        )}
      </section>
    </Arrive>
  );
}
