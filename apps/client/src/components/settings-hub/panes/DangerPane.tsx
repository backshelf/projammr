import { DeleteProjectButton } from "@/components/project/DeleteProjectButton";
import { projectDeletionLossSentence } from "@/components/project/project-deletion";
import type { HubPane, HubPaneProps } from "./types";

/** The page's head names the zone, so the pane is the warning and the one action. */
function Danger({ project }: HubPaneProps) {
  if (!project) return null;

  return (
    <section className="flex flex-col items-start gap-4">
      <p className="max-w-[54ch] text-small text-pretty text-ink-soft">
        {projectDeletionLossSentence(project.name)}
      </p>
      <DeleteProjectButton projectId={project.id} projectName={project.name} />
    </section>
  );
}

/** Deleting the project, for its owner alone. */
export const DangerPane: HubPane = {
  id: "danger",
  section: "project",
  label: "Danger zone",
  order: 60,
  minRole: "owner",
  Content: Danger,
};
