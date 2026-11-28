import { ProjectCookieUpdater } from "@/components/auth/ProjectCookieUpdater";
import { TopStrip } from "@/components/dock/TopStrip";
import { JobsRole } from "@/components/jobs/JobsProvider";
import { SettingsFormatProvider } from "@/components/format/SettingsFormatProvider";
import { cachedProject, currentProjectIdCookie } from "@/lib/server-data";
import { ProjectProvider } from "@/hooks/use-project-role";
import { viewerFormat } from "@/lib/formatters";
import { loaded } from "@/lib/loaded";
import { PoliciesProvider } from "@/lib/policies/provider";
import { cachedPolicies } from "@/lib/policies/server";
import { parseId } from "@/lib/route-pattern";
import { SettingsProvider } from "@/lib/settings/provider";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

type Props = {
  params: Promise<{ projectId: string }>;
  children: ReactNode;
};

export default async function ProjectLayout({ params, children }: Props) {
  const projectId = parseId((await params).projectId);
  if (projectId === null) notFound();

  // `projectId` is the URL's (not the `currentProject` cookie's, which lags a
  // deep link's first render). All reads run in parallel; `loaded` still turns
  // an invisible project into a 404 before anything renders.
  const [projectResult, cookieProjectId, settings, policies, format] =
    await Promise.all([
      cachedProject(projectId),
      currentProjectIdCookie(),
      cachedEffectiveSettings(projectId),
      cachedPolicies(projectId),
      viewerFormat(projectId),
    ]);
  const project = loaded(projectResult);

  return (
    <ProjectProvider
      project={{ id: project.id, name: project.name, role: project.role }}
    >
      <SettingsProvider initial={settings} projectId={project.id}>
        {/* The shell's providers sit above the project's settings; these
            rebuild from the project's store, so a project's format and
            playback conventions reach everything under it. */}
        <PoliciesProvider policies={policies}>
          <SettingsFormatProvider prefs={format.prefs} zone={format.zone}>
            <JobsRole projectId={project.id} role={project.role} />
            <ProjectCookieUpdater
              projectId={project.id}
              cookieProjectId={cookieProjectId}
            >
              <div className={"flex h-full min-h-0 flex-col"}>
                <Suspense
                  fallback={
                    <div className={"min-h-11 md:hidden"} aria-hidden />
                  }
                >
                  <TopStrip project={project} />
                </Suspense>
                <div className={"min-h-0 flex-1"}>{children}</div>
              </div>
            </ProjectCookieUpdater>
          </SettingsFormatProvider>
        </PoliciesProvider>
      </SettingsProvider>
    </ProjectProvider>
  );
}
