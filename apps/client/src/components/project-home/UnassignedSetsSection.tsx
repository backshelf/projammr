import type { ProjectToday } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { UnassignedSetsList } from "./UnassignedSetsList";

/**
 * Unassigned DAW sets waiting to be triaged onto tracks. Shown only to editors
 * and hidden completely once the inbox is clear.
 */
export async function UnassignedSetsSection({
  projectId,
  today,
  canEdit,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
  canEdit: boolean;
}) {
  if (!canEdit) return null;

  const result = await today;
  if (isActionError(result)) return null;

  const { sessions, total } = result.unassignedSets;
  if (sessions.length === 0) return null;

  return (
    <UnassignedSetsList
      projectId={projectId}
      sessions={sessions}
      total={total}
    />
  );
}
