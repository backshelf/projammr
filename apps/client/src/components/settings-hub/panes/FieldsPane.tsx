import { getCustomFields } from "@/actions/custom-fields";
import { SettingsFields } from "@/components/settings/SettingsFields";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Fields({ project }: HubPaneProps) {
  if (!project) return null;
  const [trackFields, collectionFields] = await Promise.all([
    getCustomFields(project.id, "track"),
    getCustomFields(project.id, "collection"),
  ]);

  return (
    <SettingsFields
      projectId={project.id}
      trackFields={isActionError(trackFields) ? [] : trackFields}
      collectionFields={isActionError(collectionFields) ? [] : collectionFields}
    />
  );
}

/** The project's custom fields on tracks and collections. */
export const FieldsPane: HubPane = {
  id: "fields",
  section: "project",
  label: "Fields",
  order: 27,
  minRole: "viewer",
  Content: Fields,
};
