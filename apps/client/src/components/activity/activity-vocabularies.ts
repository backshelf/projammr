import { getCustomFields } from "@/actions/custom-fields";
import { getPriorityLevels } from "@/actions/priorities";
import { getStatuses } from "@/actions/statuses";
import type { ActivityVocabularies } from "@/components/activity/ActivityList";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The project's statuses and priority levels, which name the ids a status or
 * priority change records, and its custom fields of every kind, which name a
 * custom value's change and type its values. A vocabulary that fails to load
 * is left out, and the feed prints those ids and keys as they are.
 */
export async function loadActivityVocabularies(
  projectId: number
): Promise<ActivityVocabularies> {
  const [statuses, priorityLevels, customFields] = await Promise.all([
    getStatuses(projectId),
    getPriorityLevels(projectId),
    getCustomFields(projectId),
  ]);
  return {
    statuses: isActionError(statuses) ? undefined : statuses,
    priorityLevels: isActionError(priorityLevels) ? undefined : priorityLevels,
    customFields: isActionError(customFields) ? undefined : customFields,
  };
}
