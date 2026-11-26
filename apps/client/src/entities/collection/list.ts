import { getCollectionsPageForProject } from "@/actions/projects";
import { pageQueryOf } from "@/entities/collection/api";
import type { EntityListConfig } from "@/modules/entity-list/lists";

export const collectionList = {
  kind: "collection",
  ledeOpening: "Every release and grouping in",
  loadPage: (projectId, query, _archived, pageSize) =>
    getCollectionsPageForProject(projectId, {
      ...pageQueryOf(query),
      page: 1,
      pageSize,
    }),
  loadScope: async () => ({}),
} satisfies EntityListConfig<"collection">;
