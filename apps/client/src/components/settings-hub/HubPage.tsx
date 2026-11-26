import { AppLink } from "@/components/navigation/AppLink";
import { TopStrip } from "@/components/dock/TopStrip";
import { JobsRole } from "@/components/jobs/JobsProvider";
import { ProjectProvider } from "@/hooks/use-project-role";
import { loaded } from "@/lib/loaded";
import {
  cachedIsInstanceAdmin,
  cachedProject,
  cachedShellData,
} from "@/lib/server-data";
import { roleSatisfies } from "@/lib/roles";
import { getCachedSession, sessionUser } from "@/lib/session";
import { settingsHref } from "@/lib/settings/href";
import { SettingsProvider } from "@/lib/settings/provider";
import {
  cachedEffectiveSettings,
  cachedSettingsHub,
} from "@/lib/settings/server";
import { isActionError } from "@workspace/api/lib/action-result";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { PAGE } from "@workspace/ui/lib/shell";
import {
  SETTINGS,
  type SettingKey,
  type SettingSection,
} from "@workspace/settings";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { RecentChanges } from "./audit/RecentChanges";
import { PersonalFooter } from "./export/PersonalFooter";
import { ResetGroupButton } from "./export/ResetGroupButton";
import { HubRowsProvider } from "./hub-rows";
import type { HubNavSection } from "./HubNav";
import { HubShell } from "./HubShell";
import {
  hubLayout,
  type HubEntry,
  type HubGroupEntry,
  type HubSectionView,
} from "./layout";
import { HUB_PANES } from "./panes";
import type { HubPaneProps, HubProject } from "./panes/types";
import { RestartNotice } from "./RestartNotice";
import { SavePruneNote } from "./SavePruneNote";
import { SettingGroupView } from "./SettingGroupView";

/** Why a page was sent to the hub in place of the one asked for, as `?notice=`. */
const HUB_NOTICES = {
  "no-project":
    "There is no current project to show the settings of. Open one, and its settings join these.",
} as const;

export type HubNotice = keyof typeof HUB_NOTICES;

export const isHubNotice = (value: unknown): value is HubNotice =>
  typeof value === "string" && Object.hasOwn(HUB_NOTICES, value);

/** The group or pane a section's optional catch-all names; a deeper path is a 404. */
export function entrySegment(
  rest: readonly string[] | undefined
): string | undefined {
  if (rest !== undefined && rest.length > 1) notFound();
  return rest?.[0];
}

type SearchParams = HubPaneProps["searchParams"];

/** The page frame every hub page shares: the phone's top strip over a scrolling page. */
function HubFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={<div className="min-h-11 md:hidden" aria-hidden />}>
        <TopStrip back />
      </Suspense>
      <div className="min-h-0 flex-1">
        <ScrollRoot className={PAGE}>{children}</ScrollRoot>
      </div>
    </div>
  );
}

/**
 * The project a hub page resolves its settings with: the one the URL names in
 * the Project section, which must be the caller's (a 404 otherwise), or the
 * current project elsewhere, dropped rather than failing when it cannot be read.
 */
async function pageProject(
  named: number | undefined,
  current: number | undefined
): Promise<HubProject | null> {
  if (named !== undefined) {
    const { id, name, role } = loaded(await cachedProject(named));
    return { id, name, role };
  }
  if (current === undefined) return null;
  const project = await cachedProject(current);
  if (isActionError(project)) return null;
  return { id: project.id, name: project.name, role: project.role };
}

const navOf = (sections: readonly HubSectionView[]): HubNavSection[] =>
  sections.map(({ id, label, detail, href, entries }) => ({
    id,
    label,
    ...(detail === undefined ? {} : { detail }),
    href,
    entries: entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      href: entry.href,
    })),
    hasPanes: entries.some(({ kind }) => kind === "pane"),
  }));

/**
 * One page of the settings hub: a section, or one of its groups or panes.
 * Everything a row shows comes from one hub read, resolved with the page's
 * project (the URL's in the Project section, the current one elsewhere), so
 * the rows and the search agree. A group or pane the section does not have,
 * for this caller, is a 404.
 */
export async function HubPage({
  section,
  projectId,
  entry,
  notice,
  searchParams,
}: {
  section: SettingSection;
  /** The Project section's project, from its URL. */
  projectId?: number;
  /** The group or pane the URL names. */
  entry?: string;
  notice?: HubNotice;
  searchParams: SearchParams;
}) {
  const [session, shell, isAdmin] = await Promise.all([
    getCachedSession(),
    cachedShellData(),
    cachedIsInstanceAdmin(),
  ]);
  const user = sessionUser(session);
  if (!user) redirect("/");

  const project = await pageProject(projectId, shell.currentProject?.id);
  const inProject = section === "project" && project !== null;
  const [hub, projectSettings] = await Promise.all([
    cachedSettingsHub(project?.id),
    inProject ? cachedEffectiveSettings(project.id) : null,
  ]);
  const rows = loaded(hub);

  const { sections, index } = hubLayout({
    visible: new Set(Object.keys(rows)),
    isAdmin,
    project,
    panes: HUB_PANES,
  });
  const current = sections.find(({ id }) => id === section);
  if (!current) notFound();
  const named =
    entry === undefined
      ? undefined
      : current.entries.find(({ id }) => id === entry);
  if (entry !== undefined && !named) notFound();

  // A section with no groups of its own opens on its first pane.
  const groups = current.entries.filter((each) => each.kind === "group");
  const shown =
    named ??
    (current.stacked || groups.length > 0 ? undefined : current.entries[0]);

  const content =
    shown?.kind === "pane" ? (
      <PanePage pane={shown} project={project} searchParams={searchParams} />
    ) : (
      <SectionPage
        section={current}
        project={project}
        notice={notice}
        entry={named?.id}
        searchParams={searchParams}
      />
    );

  const hubPage = (
    <HubRowsProvider
      initial={rows}
      projectId={project?.id ?? null}
      userId={user.id}
    >
      <HubShell
        sections={navOf(sections)}
        place={{ section, ...(shown ? { entry: shown.id } : {}) }}
        index={index}
      >
        {content}
      </HubShell>
    </HubRowsProvider>
  );

  return (
    <HubFrame>
      {inProject && projectSettings ? (
        // Outside `/project/:id`, so the section mounts its project's role,
        // settings and jobs role itself, as the project layout would.
        <ProjectProvider project={project}>
          <SettingsProvider initial={projectSettings} projectId={project.id}>
            <JobsRole projectId={project.id} role={project.role} />
            {hubPage}
          </SettingsProvider>
        </ProjectProvider>
      ) : (
        hubPage
      )}
    </HubFrame>
  );
}

/** What a section's own page adds to the groups and panes the registry gives it. */
type SectionExtras = {
  /** The action beside each of its groups' labels. */
  groupAction?(group: HubGroupEntry): ReactNode;
  /** A line under a setting's row, by key. */
  notes?: Partial<Record<SettingKey, ReactNode>>;
  /** What closes the page, after its groups. */
  end?(project: HubProject | null): ReactNode;
};

const SECTION_EXTRAS: Partial<Record<SettingSection, SectionExtras>> = {
  personal: {
    groupAction: (group) => <ResetGroupButton group={group} />,
    end: () => <PersonalFooter />,
  },
  // The changes at a project are for its owner and admins.
  project: {
    end: (project) =>
      project && roleSatisfies(project.role, "admin") ? (
        <RecentChanges target={{ scope: "project", id: project.id }} />
      ) : null,
  },
  // The Instance section is an instance admin's alone. Its advanced groups,
  // folded out of the way, reset in one go.
  instance: {
    notes: {
      "instance-jobs.saveContentRetentionDays": (
        <Suspense fallback={null}>
          <SavePruneNote />
        </Suspense>
      ),
    },
    groupAction: (group) =>
      group.advanced ? <ResetGroupButton group={group} /> : null,
    end: () => <RecentChanges target={{ scope: "instance", id: "instance" }} />,
  },
};

/**
 * A section's own page: its groups one after another, or its stacked panes,
 * or a note that it has none. Under its head, a notice while any of its
 * restart-required settings waits for the server to restart.
 */
function SectionPage({
  section,
  project,
  notice,
  entry,
  searchParams,
}: {
  section: HubSectionView;
  project: HubProject | null;
  notice?: HubNotice;
  /** The group or pane the URL names, which opens even when it folds. */
  entry?: string;
  searchParams: SearchParams;
}) {
  const { heading } = section;
  const extras = SECTION_EXTRAS[section.id];
  // Elsewhere a pane is a page of its own, reached from the nav.
  const entries = section.stacked
    ? section.entries
    : section.entries.filter(({ kind }) => kind === "group");
  const restartRequired = entries.flatMap((each) =>
    each.kind === "group"
      ? each.rows
          .filter(({ key }) => SETTINGS[key].restartRequired)
          .map(({ key }) => key)
      : []
  );

  return (
    <>
      <PageHead title={heading.title} lede={heading.lede} />
      {restartRequired.length > 0 && <RestartNotice keys={restartRequired} />}
      {notice && (
        <p
          role="status"
          className="max-w-[54ch] border-l border-rule-strong pl-3 text-small text-pretty text-ink-soft"
        >
          {HUB_NOTICES[notice]}
        </p>
      )}
      {entries.length === 0 ? (
        <HubEmpty />
      ) : (
        entries.map((each) =>
          each.kind === "group" ? (
            // Keyed on whether the URL names it too, so navigating to a
            // folded group opens it rather than scrolling to its closed head.
            <SettingGroupView
              key={each.id === entry ? `${each.id}:named` : each.id}
              group={each}
              action={extras?.groupAction?.(each)}
              notes={extras?.notes}
              opened={each.id === entry}
            />
          ) : (
            <PaneContent
              key={each.id}
              pane={each}
              project={project}
              searchParams={searchParams}
            />
          )
        )
      )}
      {extras?.end?.(project)}
    </>
  );
}

/** A pane as a page of its own in its section. */
function PanePage({
  pane,
  project,
  searchParams,
}: {
  pane: HubEntry;
  project: HubProject | null;
  searchParams: SearchParams;
}) {
  return (
    <>
      <PageHead title={pane.label} />
      <PaneContent pane={pane} project={project} searchParams={searchParams} />
    </>
  );
}

function PaneContent({
  pane,
  project,
  searchParams,
}: {
  pane: HubEntry;
  project: HubProject | null;
  searchParams: SearchParams;
}) {
  const registered = HUB_PANES.find(({ id }) => id === pane.id);
  if (!registered) return null;
  return (
    <Suspense fallback={null}>
      <registered.Content project={project} searchParams={searchParams} />
    </Suspense>
  );
}

/** A section with nothing in it yet for this caller. */
function HubEmpty() {
  return (
    <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">
      <p className="max-w-[54ch] text-body text-pretty text-ink-soft">
        Nothing to set here yet.
      </p>
      <AppLink
        href={settingsHref({ section: "personal" })}
        className="text-small text-art underline-offset-4 hover:underline"
      >
        Your personal settings
      </AppLink>
    </div>
  );
}
