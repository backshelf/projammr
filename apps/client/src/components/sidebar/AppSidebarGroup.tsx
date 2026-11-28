import {
  cachedCollectionSummaries,
  cachedMyNotes,
  cachedTrackSummaries,
} from "@/lib/server-data";
import {
  SidebarCollections,
  SidebarRecentNotes,
  SidebarRecentTracks,
} from "@/components/sidebar/SidebarRecents";
import {
  SidebarSections,
  type SidebarSectionContent,
} from "@/components/sidebar/SidebarSections";
import {
  cachedSidebarProjectSamples,
  cachedSidebarProjectToday,
} from "@/components/sidebar/sidebar-reads";
import { roleSatisfies } from "@/lib/roles";
import { settingsHref } from "@/lib/settings/href";
import {
  hrefFromParsedRoute,
  NEW_NOTE_HREF,
  noteHref,
  NOTES_HREF,
  noteTitle,
} from "@/lib/utils";
import type { MyProject, NoteSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { AppLink } from "@/components/navigation/AppLink";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

/**
 * The sidebar's sections for the current project. Every list goes down whole:
 * how many recents show, whether archived ones count and how the collections
 * are ordered follow the shell policy on the client.
 */
export async function AppSidebarGroup({ project }: { project?: MyProject }) {
  if (!project) {
    const allNotes = await cachedMyNotes();
    return (
      <div>
        <SidebarSections
          sections={{
            notebook: notebookSection(isActionError(allNotes) ? [] : allNotes),
          }}
        />
      </div>
    );
  }

  const canEdit = roleSatisfies(project.role, "editor");
  const [collections, allTracks, allNotes, today, samples] = await Promise.all([
    cachedCollectionSummaries(project.id),
    cachedTrackSummaries(project.id),
    cachedMyNotes(),
    canEdit ? cachedSidebarProjectToday(project.id) : Promise.resolve(null),
    canEdit ? cachedSidebarProjectSamples(project.id) : Promise.resolve(null),
  ]);

  if (isActionError(collections)) {
    return <p>Could not retrieve collections</p>;
  }

  const tracks = (isActionError(allTracks) ? [] : allTracks).map((track) => ({
    id: track.id,
    label: track.title,
    href: hrefFromParsedRoute({ kind: "track", trackId: track.id }, project.id),
    swatch: track.artwork,
    archivedAt: track.archivedAt,
  }));

  const unassignedCount =
    today && !isActionError(today) ? today.unassignedSets.total : 0;
  const missingSampleCount =
    samples && !isActionError(samples)
      ? samples.filter((s) => s.missing).length
      : 0;

  return (
    <div>
      <SidebarSections
        sections={{
          collections: {
            label: "Collections",
            ...(canEdit
              ? {
                  hrefNew: hrefFromParsedRoute(
                    { kind: "collection-new" },
                    project.id
                  ),
                  newLabel: "New collection",
                }
              : {}),
            hrefAll: hrefFromParsedRoute(
              { kind: "collection-all" },
              project.id
            ),
            children: (
              <SidebarCollections
                collections={collections}
                projectId={project.id}
              />
            ),
          },
          tracks: {
            label: "Tracks",
            ...(canEdit
              ? {
                  hrefNew: hrefFromParsedRoute(
                    { kind: "track-new" },
                    project.id
                  ),
                  newLabel: "New track",
                }
              : {}),
            hrefAll: hrefFromParsedRoute({ kind: "track-all" }, project.id),
            children: (
              <SidebarRecentTracks
                tracks={tracks}
                hrefAll={hrefFromParsedRoute({ kind: "track-all" }, project.id)}
                allLabel="Show all tracks"
              />
            ),
          },
          ...(canEdit
            ? {
                studio: {
                  label: "Studio",
                  separator: true,
                  children: (
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <AppLink
                            href={hrefFromParsedRoute(
                              { kind: "session-all" },
                              project.id
                            )}
                            className="flex items-center gap-2"
                          >
                            <span>DAW Sets</span>
                            {unassignedCount > 0 && (
                              <span className="ml-auto rounded-full bg-ink/8 px-1.5 py-0.5 text-micro text-ink-soft tabular-nums">
                                {unassignedCount} unassigned
                              </span>
                            )}
                          </AppLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <AppLink
                            href={hrefFromParsedRoute(
                              { kind: "plugins" },
                              project.id
                            )}
                          >
                            Plugins
                          </AppLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <AppLink
                            href={hrefFromParsedRoute(
                              { kind: "samples" },
                              project.id
                            )}
                            className="flex items-center gap-2"
                          >
                            <span>Samples</span>
                            {missingSampleCount > 0 && (
                              <span
                                role="img"
                                aria-label={`${missingSampleCount} missing samples`}
                                className="ml-auto size-1.5 rounded-full bg-warn"
                              />
                            )}
                          </AppLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <AppLink
                            href={`${settingsHref({
                              section: "project",
                              projectId: project.id,
                              group: "assets",
                            })}#repos`}
                          >
                            Repositories
                          </AppLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  ),
                },
              }
            : {}),
          notebook: notebookSection(isActionError(allNotes) ? [] : allNotes),
        }}
      />
    </div>
  );
}

function notebookSection(notes: NoteSummary[]): SidebarSectionContent {
  const items = notes.map((note) => ({
    id: note.id,
    label: noteTitle(note.title),
    href: noteHref(note.id),
    updatedAt: note.updatedAt,
    badge: note.track?.title ?? null,
  }));

  return {
    label: "Notebook",
    separator: true,
    hint: "Personal",
    hrefNew: NEW_NOTE_HREF,
    newLabel: "New note",
    hrefAll: NOTES_HREF,
    children: (
      <SidebarRecentNotes
        notes={items}
        hrefAll={NOTES_HREF}
        allLabel="Show all notes"
      />
    ),
  };
}
