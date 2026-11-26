import { getCollectionSummaries } from "@/actions/projects";
import { getTracksPageForProject } from "@/actions/tracks";
import { pageQueryOf } from "@/entities/track/api";
import type { EntityListConfig } from "@/modules/entity-list/lists";
import { isActionError } from "@workspace/api/lib/action-result";

export const trackList = {
  kind: "track",
  ledeOpening: "Every track in",
  loadPage: (projectId, query, archived, pageSize) =>
    getTracksPageForProject(projectId, {
      ...pageQueryOf(query),
      // The route's own archived scope (set for the archived route only)
      // wins; otherwise `pageQueryOf`'s own read of `query.archived` stands.
      ...(archived ? { archived } : {}),
      page: 1,
      pageSize,
    }),
  loadScope: async (projectId) => {
    const collections = await getCollectionSummaries(projectId);
    return { collections: isActionError(collections) ? [] : collections };
  },
  archived: {
    route: { kind: "track-archived" },
    count: async (projectId) => {
      const page = await getTracksPageForProject(projectId, {
        page: 1,
        pageSize: 1,
        archived: "only",
      });
      return isActionError(page) ? 0 : page.rowCount;
    },
  },
} satisfies EntityListConfig<"track">;
