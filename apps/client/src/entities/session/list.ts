import { getSessionDaws } from "@/actions/projects";
import { getMachines, getSessionsPageForProject } from "@/actions/sessions";
import { getTrackSummaries } from "@/actions/tracks";
import { pageQueryOf } from "@/entities/session/api";
import type { EntityListConfig } from "@/modules/entity-list/lists";
import { isActionError } from "@workspace/api/lib/action-result";

export const sessionList = {
  kind: "session",
  ledeOpening: "Every DAW session in",
  loadPage: (projectId, query, _archived, pageSize) =>
    getSessionsPageForProject(projectId, {
      ...pageQueryOf(query),
      page: 1,
      pageSize,
    }),
  loadScope: async (projectId) => {
    const [tracks, daws, machines] = await Promise.all([
      getTrackSummaries(projectId),
      getSessionDaws(projectId),
      getMachines(),
    ]);
    return {
      tracks: isActionError(tracks)
        ? []
        : tracks.map((t) =>
            t.archivedAt ? { ...t, title: `${t.title} (archived)` } : t
          ),
      daws: isActionError(daws) ? [] : daws,
      machines,
    };
  },
} satisfies EntityListConfig<"session">;
