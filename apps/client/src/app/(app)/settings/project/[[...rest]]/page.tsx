import { HubPage, type HubNotice } from "@/components/settings-hub/HubPage";
import { parseId } from "@/lib/route-pattern";
import { cachedShellData } from "@/lib/server-data";
import { settingsHref } from "@/lib/settings/href";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Project settings" };

type Props = {
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NO_PROJECT: HubNotice = "no-project";

/**
 * `/settings/project/<id>[/<group-or-pane>]`. Bare `/settings/project` goes on
 * to the current project's settings, or, with no current project (none yet,
 * or one since deleted or left), to Personal with a note saying why.
 */
export default async function Page({ params, searchParams }: Props) {
  const [{ rest }, query] = await Promise.all([params, searchParams]);

  if (rest === undefined) {
    const { currentProject } = await cachedShellData();
    redirect(
      currentProject
        ? settingsHref({ section: "project", projectId: currentProject.id })
        : `${settingsHref({ section: "personal" })}?notice=${NO_PROJECT}`
    );
  }

  const [id, entry, ...deeper] = rest;
  const projectId = parseId(id);
  if (projectId === null || deeper.length > 0) notFound();

  return (
    <HubPage
      section="project"
      projectId={projectId}
      entry={entry}
      searchParams={query}
    />
  );
}
