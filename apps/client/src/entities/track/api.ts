import type { BulkSelection, TableEntityApi } from "@/entities/api";
import type { EntityTableScope } from "@/entities/table-types";
import {
  customFieldFilters,
  declaredFilters,
  type TableSearchParams,
} from "@/lib/table-params";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import { TRACK_FILTER_PARAMS } from "@workspace/api/lib/enums";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  ListTrack,
  MoveReport,
  NewTrack,
  Track,
  TracksPageQuery,
} from "@workspace/api/api";

/**
 * Which archived tracks a table asks for: the scope's own choice, else all of a
 * collection's (archived tracks keep their place there, flagged), else the
 * view's own `archived` query param, else live ones only.
 */
export function archivedScopeOf(
  scope?: EntityTableScope["track"],
  view?: Pick<TableSearchParams, "archived">
): TracksPageQuery["archived"] {
  if (scope?.archived) return scope.archived;
  if (scope?.collectionId != null) return "include";
  return view?.archived;
}

/**
 * The `/tracks/paginated` query for one view: every filter the route declares
 * and every custom field filter, dropped of `page` (which {@link trackApi.page}
 * adds beside it). A scoped table's own `collectionId` wins over the view's
 * `collection` filter, the same precedence the board's `fetchPage` already
 * applies.
 */
export function pageQueryOf(
  view: TableSearchParams,
  scope?: EntityTableScope["track"]
): Omit<TracksPageQuery, "page"> {
  return {
    archived: archivedScopeOf(scope, view),
    q: view.q,
    sort: view.sort,
    groupBy: view.group,
    ...declaredFilters(view, TRACK_FILTER_PARAMS),
    ...customFieldFilters(view),
    collection: scope?.collectionId ?? view.collection,
  };
}

export const trackApi: TableEntityApi<
  Track,
  NewTrack,
  TracksPageQuery,
  ListTrack
> = {
  async patch(api: ApiClient, id: number, body: Record<string, unknown>) {
    const res = await api.PATCH("/api/tracks/{id}", {
      params: { path: { id: String(id) } },
      body: body as never,
    });

    return toActionResult(res, "Failed to save");
  },

  async remove(api: ApiClient, id: number) {
    const res = await api.DELETE("/api/tracks/{id}", {
      params: { path: { id: String(id) } },
    });

    return toActionOutcome(res, "Failed to delete track", {
      ok: true,
    } as const);
  },

  async create(api: ApiClient, payload: NewTrack) {
    const res = await api.POST("/api/tracks", {
      body: { ...payload, projectId: Number(payload.projectId) },
    });

    return toActionResult(res, "Failed to create track");
  },

  async bulkPatch(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    patch: Record<string, unknown>
  ) {
    const res = await api.PATCH("/api/tracks/bulk", {
      body: { projectId: Number(projectId), selection, patch } as never,
    });

    return toActionResult(res, "Failed to update rows");
  },

  async bulkRemove(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection
  ) {
    const res = await api.DELETE("/api/tracks/bulk", {
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
    const res = await api.PATCH("/api/tracks/bulk/labels", {
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
    const res = await api.POST("/api/tracks/bulk/move", {
      body: {
        projectId: Number(projectId),
        selection,
        targetProjectId,
      } as never,
    });

    return toActionResult(res, "Failed to move rows");
  },

  async move(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/tracks/{id}/move", {
      params: { path: { id: String(id) } },
      body: { projectId },
    });

    return toActionResult<MoveReport>(res, "Failed to move", {
      messages: { 403: "You need edit access in both projects to move this" },
    });
  },

  async movePreview(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/tracks/{id}/move/preview", {
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
    const res = await api.POST("/api/tracks/bulk/move/preview", {
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
    const res = await api.PUT("/api/tracks/{id}/labels", {
      params: { path: { id: String(id) } },
      body: input as never,
    });

    return toActionResult(res, "Failed to set labels");
  },

  async page(
    api: ApiClient,
    projectId: number,
    query: TracksPageQuery & { page: number }
  ) {
    const res = await api.GET("/api/projects/{id}/tracks/paginated", {
      params: {
        path: { id: String(projectId) },
        query,
      },
    });

    return toActionResult(res, "Failed to fetch tracks");
  },
};

/**
 * Archives (or unarchives) a selection of tracks. Answers only the tracks that
 * changed and the sessions on them.
 */
export async function requestTracksArchived(
  api: ApiClient,
  projectId: number,
  selection: BulkSelection,
  archived: boolean
): Promise<{ ids: number[]; sessionCount: number } | ActionError> {
  const body = { projectId: Number(projectId), selection } as never;
  const res = archived
    ? await api.POST("/api/tracks/bulk/archive", { body })
    : await api.POST("/api/tracks/bulk/unarchive", { body });

  return toActionResult(
    res,
    archived ? "Failed to archive tracks" : "Failed to unarchive tracks"
  );
}

/** Relate `fromTrackId` as a derivative of `toTrackId`, as one of the
 *  project's relation types. Another project's type is a 400. */
export async function addRelation(
  api: ApiClient,
  fromTrackId: number,
  toTrackId: number,
  relationTypeId: number
): Promise<{ ok: true } | ActionError> {
  const res = await api.POST("/api/tracks/{id}/relations", {
    params: { path: { id: String(fromTrackId) } },
    body: { toTrackId, relationTypeId },
  });

  return toActionOutcome(res, "Failed to add relation", { ok: true } as const);
}

/** Remove a relation touching `trackId`, by relation id. */
export async function removeRelation(
  api: ApiClient,
  trackId: number,
  relationId: number
): Promise<{ ok: true } | ActionError> {
  const res = await api.DELETE("/api/tracks/{id}/relations/{relationId}", {
    params: {
      path: { id: String(trackId), relationId: String(relationId) },
    },
  });

  return toActionOutcome(res, "Failed to remove relation", {
    ok: true,
  } as const);
}
