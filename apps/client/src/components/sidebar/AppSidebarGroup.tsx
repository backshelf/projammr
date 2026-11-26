import {
  cachedCollectionSummaries,
  cachedMyNotes,
  cachedSessionSummaries,
  cachedTrackSummaries,
} from "@/lib/server-data";
import {
  SidebarCollections,
  SidebarRecentNotes,
  SidebarRecentSessions,
  SidebarRecentTracks,
} from "@/components/sidebar/SidebarRecents";
import {
  SidebarSections,
  type SidebarSectionContent,
} from "@/components/sidebar/SidebarSections";
import {
  hrefFromParsedRoute,
  NEW_NOTE_HREF,
  noteHref,
  NOTES_HREF,
  noteTitle,
} from "@/lib/utils";
import type { NoteSummary, Project } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The sidebar's sections for the current project. Every list goes down whole:
 * how many recents show, whether archived ones count and how the collections
 * are ordered follow the shell policy on the client.
 */
export async function AppSidebarGroup({
  project,
}: {
  project?: Omit<Project, "attachments" | "role" | "artwork">;
}) {
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

  const [collections, allTracks, allSessions, allNotes] = await Promise.all([
    cachedCollectionSummaries(project.id),
    cachedTrackSummaries(project.id),
    cachedSessionSummaries(project.id),
    cachedMyNotes(),
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
  const sessions = (isActionError(allSessions) ? [] : allSessions).map(
    (session) => ({
      id: session.id,
      label: session.name,
      href: hrefFromParsedRoute(
        {
          kind: "session",
          sessionId: session.id,
          trackId: session.trackId ?? undefined,
        },
        project.id
      ),
      archived: session.archived,
    })
  );

  return (
    <div>
      <SidebarSections
        sections={{
          collections: {
            label: "Collections",
            hrefNew: hrefFromParsedRoute(
              { kind: "collection-new" },
              project.id
            ),
            newLabel: "New collection",
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
            hrefNew: hrefFromParsedRoute({ kind: "track-new" }, project.id),
            newLabel: "New track",
            hrefAll: hrefFromParsedRoute({ kind: "track-all" }, project.id),
            children: (
              <SidebarRecentTracks
                tracks={tracks}
                hrefAll={hrefFromParsedRoute({ kind: "track-all" }, project.id)}
                allLabel="Show all tracks"
              />
            ),
          },
          notebook: notebookSection(isActionError(allNotes) ? [] : allNotes),
          sessions: {
            label: "Sessions",
            hrefNew: hrefFromParsedRoute({ kind: "session-new" }, project.id),
            newLabel: "New session",
            hrefAll: hrefFromParsedRoute({ kind: "session-all" }, project.id),
            children: (
              <SidebarRecentSessions
                sessions={sessions}
                hrefAll={hrefFromParsedRoute(
                  { kind: "session-all" },
                  project.id
                )}
                allLabel="Show all sessions"
              />
            ),
          },
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
  }));

  return {
    label: "Notebook",
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
