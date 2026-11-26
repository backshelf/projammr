import { getRelationTypes } from "@/actions/relation-types";
import { SettingsRelationTypes } from "@/components/settings/SettingsRelationTypes";
import { roleSatisfies } from "@/lib/roles";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function RelationTypes({ project }: HubPaneProps) {
  if (!project) return null;
  const result = await getRelationTypes(project.id);

  return (
    <SettingsRelationTypes
      projectId={project.id}
      relationTypes={isActionError(result) ? [] : result}
      canEdit={roleSatisfies(project.role, "editor")}
    />
  );
}

/** The project's own relation types: what a track relation can be named. */
export const RelationTypesPane: HubPane = {
  id: "relation-types",
  section: "project",
  label: "Relation types",
  order: 23,
  minRole: "viewer",
  Content: RelationTypes,
};
