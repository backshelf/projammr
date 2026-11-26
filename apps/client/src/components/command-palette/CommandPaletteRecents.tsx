import { CommandPaletteMount } from "@/components/command-palette/CommandPaletteMount";
import { settingResults } from "@/components/command-palette/settings-results";
import { roleSatisfies } from "@/lib/roles";
import {
  cachedIsInstanceAdmin,
  cachedMyProjects,
  cachedProject,
  cachedSessionSummaries,
  cachedTrackSummaries,
} from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import { cookies } from "next/headers";

/**
 * Mounts the palette with the current project's tracks and sessions, newest
 * first; the mount slices them as the sidebar does, so an empty query has
 * something to offer without the browser keeping a copy of its own. It also
 * hands over the viewer's role and every track's archived state, which the
 * archive commands read on a track page, and every setting the viewer can
 * open in the settings hub, which a query matches on any page.
 */
export async function CommandPaletteRecents() {
  const cookieStore = await cookies();
  const currentProjectId = Number(
    cookieStore.get("currentProject")?.value ?? 0
  );
  const [projects, isAdmin] = await Promise.all([
    cachedMyProjects(),
    cachedIsInstanceAdmin(),
  ]);
  const project = projects.find((p) => p.id === currentProjectId);

  if (!project) {
    return (
      <CommandPaletteMount
        settings={settingResults({ isAdmin, project: null })}
      />
    );
  }

  const [detail, tracksResult, sessionsResult] = await Promise.all([
    cachedProject(project.id),
    cachedTrackSummaries(project.id),
    cachedSessionSummaries(project.id),
  ]);
  const tracks = isActionError(tracksResult) ? [] : tracksResult;
  const sessions = isActionError(sessionsResult) ? [] : sessionsResult;

  return (
    <CommandPaletteMount
      recents={{
        projectId: project.id,
        canEdit: !isActionError(detail) && roleSatisfies(detail.role, "editor"),
        allTracks: tracks.map((t) => ({
          id: t.id,
          title: t.title,
          archived: t.archivedAt !== null,
        })),
        tracks: tracks.map((t) => ({
          id: t.id,
          title: t.title,
          archivedAt: t.archivedAt,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          trackId: s.trackId,
          archived: s.archived,
        })),
      }}
      settings={settingResults({
        isAdmin,
        project: isActionError(detail)
          ? null
          : { id: detail.id, name: detail.name, role: detail.role },
      })}
    />
  );
}
