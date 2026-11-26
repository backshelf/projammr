import type { BulkSelection, TableEntityApi } from "@/entities/api";
import {
  customFieldFilters,
  declaredFilters,
  type TableSearchParams,
} from "@/lib/table-params";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import { COLLECTION_FILTER_PARAMS } from "@workspace/api/lib/enums";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  Collection,
  CollectionsPageQuery,
  ListCollection,
  MoveReport,
  NewCollection,
} from "@workspace/api/api";

/**
 * The `/collections/paginated` query for one view: every filter the route
 * declares and every custom field filter, dropped of `page` (which
 * {@link collectionApi.page} adds beside it). Collection tables have no scope,
 * so it takes the view alone.
 */
export function pageQueryOf(
  view: TableSearchParams
): Omit<CollectionsPageQuery, "page"> {
  return {
    q: view.q,
    sort: view.sort,
    groupBy: view.group,
    ...declaredFilters(view, COLLECTION_FILTER_PARAMS),
    ...customFieldFilters(view),
  };
}

export const collectionApi: TableEntityApi<
  Collection,
  NewCollection,
  CollectionsPageQuery,
  ListCollection
> = {
  async patch(api: ApiClient, id: number, body: Record<string, unknown>) {
    const res = await api.PATCH("/api/collections/{id}", {
      params: { path: { id: String(id) } },
      body: body as never,
    });

    return toActionResult(res, "Failed to save");
  },

  async remove(api: ApiClient, id: number) {
    const res = await api.DELETE("/api/collections/{id}", {
      params: { path: { id: String(id) } },
    });

    return toActionOutcome(res, "Failed to delete collection", {
      ok: true,
    } as const);
  },

  async create(api: ApiClient, payload: NewCollection) {
    const res = await api.POST("/api/collections", {
      body: payload,
    });

    return toActionResult(res, "Failed to create collection");
  },

  async bulkPatch(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    patch: Record<string, unknown>
  ) {
    const res = await api.PATCH("/api/collections/bulk", {
      body: { projectId: Number(projectId), selection, patch } as never,
    });

    return toActionResult(res, "Failed to update rows");
  },

  async bulkRemove(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection
  ) {
    const res = await api.DELETE("/api/collections/bulk", {
      body: { projectId: Number(projectId), selection } as never,
    });

    return toActionResult(res, "Failed to delete rows");
  },

  async bulkSetLabels(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    { add, remove }: { add: number[]; remove: number[] }
  ) {
    const res = await api.PATCH("/api/collections/bulk/labels", {
      body: { projectId: Number(projectId), selection, add, remove } as never,
    });

    return toActionResult(res, "Failed to update labels");
  },

  async bulkMove(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    targetProjectId: number
  ) {
    const res = await api.POST("/api/collections/bulk/move", {
      body: {
        projectId: Number(projectId),
        selection,
        targetProjectId,
      } as never,
    });

    return toActionResult(res, "Failed to move rows");
  },

  async move(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/collections/{id}/move", {
      params: { path: { id: String(id) } },
      body: { projectId },
    });

    return toActionResult<MoveReport>(res, "Failed to move", {
      messages: { 403: "You need edit access in both projects to move this" },
    });
  },

  async movePreview(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/collections/{id}/move/preview", {
      params: { path: { id: String(id) } },
      body: { projectId },
    });

    return toActionResult(res, "Failed to check the move");
  },

  async bulkMovePreview(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    targetProjectId: number
  ) {
    const res = await api.POST("/api/collections/bulk/move/preview", {
      body: {
        projectId: Number(projectId),
        selection,
        targetProjectId,
      } as never,
    });

    return toActionResult(res, "Failed to check the move");
  },

  async setLabels(
    api: ApiClient,
    id: number,
    input: { labelIds?: number[]; names?: string[] }
  ) {
    const res = await api.PUT("/api/collections/{id}/labels", {
      params: { path: { id: String(id) } },
      body: input as never,
    });

    return toActionResult(res, "Failed to set labels");
  },

  async page(
    api: ApiClient,
    projectId: number,
    query: CollectionsPageQuery & { page: number }
  ) {
    const res = await api.GET("/api/projects/{id}/collections/paginated", {
      params: {
        path: { id: String(projectId) },
        query,
      },
    });

    return toActionResult(res, "Failed to fetch collections");
  },
};

/**
 * Adds tracks to a collection. The bulk endpoint covers the single case, so
 * every "add to collection" path in the app is this one call.
 */
export async function linkTracks(
  api: ApiClient,
  collectionId: number,
  trackIds: number[]
): Promise<{ added: number } | ActionError> {
  const res = await api.POST("/api/collections/{id}/tracks/bulk", {
    params: { path: { id: String(collectionId) } },
    body: { trackIds },
  });

  return toActionResult(res, "Failed to add tracks to collection");
}
