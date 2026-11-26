import { getProjectInvites, getProjectMembers } from "@/actions/members";
import SettingsMembers from "@/components/settings/SettingsMembers";
import { getCachedSession, sessionUser } from "@/lib/session";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Members({ project }: HubPaneProps) {
  if (!project) return null;
  const [members, invites, session] = await Promise.all([
    getProjectMembers(project.id),
    getProjectInvites(project.id),
    getCachedSession(),
  ]);

  return (
    <SettingsMembers
      projectId={project.id}
      projectName={project.name}
      currentUserId={sessionUser(session)?.id ?? ""}
      members={isActionError(members) ? [] : members}
      invites={isActionError(invites) ? [] : invites}
    />
  );
}

/** Who is in the project, their roles, and the invites still open. */
export const MembersPane: HubPane = {
  id: "members",
  section: "project",
  label: "Members",
  order: 50,
  minRole: "viewer",
  Content: Members,
};
