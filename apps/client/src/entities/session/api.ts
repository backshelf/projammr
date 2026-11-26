import type { BulkSelection, TableEntityApi } from "@/entities/api";
import type { EntityTableScope } from "@/entities/table-types";
import { isDawId } from "@/lib/daw";
import { declaredFilters, type TableSearchParams } from "@/lib/table-params";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import { SESSION_FILTER_PARAMS } from "@workspace/api/lib/enums";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ListSession,
  MoveReport,
  NewSession,
  Session,
  SessionsPageQuery,
} from "@workspace/api/api";

/**
 * The `/sessions/paginated` query for one view: every filter the route reads,
 * dropped of `page` (which {@link sessionApi.page} adds beside it). A scoped
 * table's own `trackId` wins over the view's `track` filter, the same
 * precedence the track pair lets `scope.collectionId` win over
 * `view.collection`. The route has no collection filter, so
 * `scope.collectionId` cannot be forwarded. The route hides an archived
 * track's sessions by default; a table scoped to one track is that track's
 * own list, so it asks for them whether or not the track is archived.
 */
export function pageQueryOf(
  view: TableSearchParams,
  scope?: EntityTableScope["session"]
): Omit<SessionsPageQuery, "page"> {
  return {
    q: view.q,
    sort: view.sort,
    groupBy: view.group,
    ...declaredFilters(view, SESSION_FILTER_PARAMS),
    // The server refuses a malformed DAW id with a 400; page 1's action drops
    // one the same way, so every page of the view agrees.
    daw: view.daw != null && isDawId(view.daw) ? view.daw : undefined,
    track: scope?.trackId ?? view.track,
    archived: scope?.trackId != null ? "include" : undefined,
  };
}

export const sessionApi: TableEntityApi<
  Session,
  NewSession,
  SessionsPageQuery,
  ListSession
> = {
  async patch(api: ApiClient, id: number, body: Record<string, unknown>) {
    const res = await api.PATCH("/api/sessions/{id}", {
      params: { path: { id: String(id) } },
      body: body as never,
    });

    return toActionResult(res, "Failed to save");
  },

  async remove(api: ApiClient, id: number) {
    const res = await api.DELETE("/api/sessions/{id}", {
      params: { path: { id: String(id) } },
    });

    return toActionOutcome(res, "Failed to delete session", {
      ok: true,
    } as const);
  },

  async create(api: ApiClient, payload: NewSession) {
    const res = await api.POST("/api/sessions", {
      body: payload,
    });

    return toActionResult(res, "Failed to create session");
  },

  async bulkPatch(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection,
    patch: Record<string, unknown>
  ) {
    const res = await api.PATCH("/api/sessions/bulk", {
      body: { projectId: Number(projectId), selection, patch } as never,
    });

    return toActionResult(res, "Failed to update rows");
  },

  async bulkRemove(
    api: ApiClient,
    projectId: number,
    selection: BulkSelection
  ) {
    const res = await api.DELETE("/api/sessions/bulk", {
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
    const res = await api.PATCH("/api/sessions/bulk/labels", {
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
    const res = await api.POST("/api/sessions/bulk/move", {
      body: {
        projectId: Number(projectId),
        selection,
        targetProjectId,
      } as never,
    });

    return toActionResult(res, "Failed to move rows");
  },

  async move(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/sessions/{id}/move", {
      params: { path: { id: String(id) } },
      body: { projectId },
    });

    return toActionResult<MoveReport>(res, "Failed to move", {
      messages: { 403: "You need edit access in both projects to move this" },
    });
  },

  async movePreview(api: ApiClient, id: number, projectId: number) {
    const res = await api.POST("/api/sessions/{id}/move/preview", {
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
    const res = await api.POST("/api/sessions/bulk/move/preview", {
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
    const res = await api.PUT("/api/sessions/{id}/labels", {
      params: { path: { id: String(id) } },
      body: input as never,
    });

    return toActionResult(res, "Failed to set labels");
  },

  async page(
    api: ApiClient,
    projectId: number,
    query: SessionsPageQuery & { page: number }
  ) {
    const res = await api.GET("/api/projects/{id}/sessions/paginated", {
      params: {
        path: { id: String(projectId) },
        query,
      },
    });

    return toActionResult(res, "Failed to fetch sessions");
  },
};
