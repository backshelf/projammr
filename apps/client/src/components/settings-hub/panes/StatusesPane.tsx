import { getStatuses } from "@/actions/statuses";
import { SettingsStatuses } from "@/components/settings/SettingsStatuses";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Statuses({ project }: HubPaneProps) {
  if (!project) return null;
  const result = await getStatuses(project.id);

  return (
    <SettingsStatuses
      projectId={project.id}
      statuses={isActionError(result) ? [] : result}
    />
  );
}

/** The project's own statuses, beside the instance's shared ones. */
export const StatusesPane: HubPane = {
  id: "statuses",
  section: "project",
  label: "Statuses",
  order: 10,
  minRole: "viewer",
  Content: Statuses,
};
