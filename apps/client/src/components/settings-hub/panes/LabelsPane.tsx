import { getLabels } from "@/actions/labels";
import { SettingsLabels } from "@/components/settings/SettingsLabels";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Labels({ project }: HubPaneProps) {
  if (!project) return null;
  const result = await getLabels(project.id);

  return (
    <SettingsLabels
      projectId={project.id}
      labels={isActionError(result) ? [] : result}
    />
  );
}

/** The project's label vocabulary. */
export const LabelsPane: HubPane = {
  id: "labels",
  section: "project",
  label: "Labels",
  order: 20,
  minRole: "viewer",
  Content: Labels,
};
