import { hrefFromParsedRoute, NOTES_HREF, PROJECTS_HREF } from "@/lib/utils";
import type { SettingsValues } from "@workspace/settings";

type Landing = SettingsValues["navigation.landing"];

/** Whether `id` names one of the caller's own projects. */
function isMember(
  id: number | null,
  projects: readonly { id: number }[]
): id is number {
  return id !== null && projects.some((project) => project.id === id);
}

/**
 * Where `/` sends a signed-in member, following `navigation.landing`: their
 * last project, a project they chose, the projects list, or the notebook. A
 * cookie or a chosen project that no longer names one of `projects` — left
 * or deleted — is treated exactly as having none, never redirected to and
 * never cleared here: a Server Component cannot write cookies, and the
 * projects list is always a safe landing. The one-project shortcut (skip the
 * list when there is only one project to show) applies to `last-project`
 * alone; `project` and `projects` never guess at a project the caller did not
 * choose.
 */
export function landingHref({
  landing,
  defaultProject,
  cookieProjectId,
  projects,
}: {
  landing: Landing;
  defaultProject: number | null;
  cookieProjectId: number | null;
  projects: readonly { id: number }[];
}): string {
  if (landing === "notebook") return NOTES_HREF;
  if (landing === "projects") return PROJECTS_HREF;

  if (landing === "project") {
    return isMember(defaultProject, projects)
      ? hrefFromParsedRoute({ kind: "project" }, defaultProject)
      : PROJECTS_HREF;
  }

  if (isMember(cookieProjectId, projects)) {
    return hrefFromParsedRoute({ kind: "project" }, cookieProjectId);
  }
  return projects.length === 1
    ? hrefFromParsedRoute({ kind: "project" }, projects[0]!.id)
    : PROJECTS_HREF;
}
