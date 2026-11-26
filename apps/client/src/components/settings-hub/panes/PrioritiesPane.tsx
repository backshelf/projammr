import { getPriorityLevels } from "@/actions/priorities";
import { SettingsPriorities } from "@/components/settings/SettingsPriorities";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Priorities({ project }: HubPaneProps) {
  if (!project) return null;
  const result = await getPriorityLevels(project.id);

  return (
    <SettingsPriorities
      projectId={project.id}
      levels={isActionError(result) ? [] : result}
    />
  );
}

/** The project's priority scale. */
export const PrioritiesPane: HubPane = {
  id: "priorities",
  section: "project",
  label: "Priorities",
  order: 25,
  minRole: "viewer",
  Content: Priorities,
};
