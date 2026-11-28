import { AccountSheet } from "@/components/dock/AccountSheet";
import { ProjectSwitcherSheet } from "@/components/dock/ProjectSwitcherSheet";
import { QuickCreateSheet } from "@/components/dock/QuickCreateSheet";
import { JobsTraySheet } from "@/components/jobs/JobsTray";
import { AppLink } from "@/components/navigation/AppLink";
import { roleSatisfies } from "@/lib/roles";
import { cachedShellData } from "@/lib/server-data";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconChevronLeft } from "@tabler/icons-react";
import type { MemberRole, Project } from "@workspace/api/api";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

type ProjectSummary = Pick<Project, "id" | "name" | "image"> & {
  role?: MemberRole;
};

/**
 * The phone's top chrome: the project switcher on the left, the account menu
 * on the right. It sits in normal flow above the page rather than fixed, so a
 * page's own masthead is never covered. `min-h-11` (not a fixed height) keeps
 * the content row 44px tall regardless of the top inset — border-box would
 * otherwise take a notched phone's safe-area padding out of a fixed height
 * and leave nothing for the content.
 *
 * With no project open the strip still renders — it is the only way to reach
 * the projects you already have from a page that has none.
 *
 * `back` is for the pages outside any project (`/profile`, `/project/new`):
 * an installed PWA has no browser chrome to go back with, so the name slot
 * becomes a link to the last project instead of the switcher trigger.
 */
export async function TopStrip({
  project,
  back = false,
}: {
  project?: ProjectSummary;
  back?: boolean;
}) {
  const { user, projects, currentProject } = await cachedShellData();
  const activeProject = project ?? currentProject;
  const canEdit = activeProject?.role
    ? roleSatisfies(activeProject.role, "editor")
    : false;

  return (
    <div
      className={
        "flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-rule bg-paper px-(--gutter) pt-[env(safe-area-inset-top)] md:hidden"
      }
    >
      {back ? (
        <BackLink target={currentProject} />
      ) : (
        <ProjectSwitcherSheet
          projects={projects}
          currentProject={activeProject}
        />
      )}
      <div className={"flex items-center gap-1"}>
        {user && (
          <QuickCreateSheet
            projectId={activeProject?.id ?? null}
            canEdit={canEdit}
          />
        )}
        <JobsTraySheet />
        {user && <AccountSheet user={user} />}
      </div>
    </div>
  );
}

function BackLink({ target }: { target?: ProjectSummary }) {
  const href = target
    ? hrefFromParsedRoute({ kind: "project" }, target.id)
    : "/";

  return (
    <AppLink
      href={href}
      className={cn(LABEL, "flex min-h-11 items-center gap-1 text-ink")}
    >
      <IconChevronLeft className={"size-4"} />
      Back
    </AppLink>
  );
}
