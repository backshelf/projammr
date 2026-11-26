import type { EntityApi } from "@/entities/api";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type { ActionError, SavedView, SavedViewKind } from "@workspace/api/api";

export const projectApi: EntityApi = {
  async patch(api: ApiClient, id: number, body: Record<string, unknown>) {
    const res = await api.PATCH("/api/projects/{id}", {
      params: { path: { id: String(id) } },
      // The field name is only known at runtime; the typed client can't index a body by it.
      body: body as never,
    });

    return toActionResult(res, "Failed to save");
  },

  async remove(api: ApiClient, id: number) {
    const res = await api.DELETE("/api/projects/{id}", {
      params: { path: { id: String(id) } },
    });

    return toActionOutcome(res, "Failed to delete project", {
      ok: true,
    } as const);
  },
};

export async function createSavedView(
  api: ApiClient,
  projectId: number,
  kind: SavedViewKind,
  name: string,
  query: string
): Promise<SavedView | ActionError> {
  const res = await api.POST("/api/projects/{id}/saved-views", {
    params: { path: { id: String(projectId) } },
    body: { name, kind, config: { query } },
  });

  return toActionResult(res, "Failed to save view");
}

export async function deleteSavedView(
  api: ApiClient,
  projectId: number,
  viewId: number
): Promise<{ ok: true } | ActionError> {
  const res = await api.DELETE("/api/projects/{id}/saved-views/{viewId}", {
    params: {
      path: { id: String(projectId), viewId: String(viewId) },
    },
  });

  return toActionOutcome(res, "Failed to delete view", { ok: true } as const);
}

export async function updateSavedView(
  api: ApiClient,
  projectId: number,
  viewId: number,
  patch: { shared: boolean }
): Promise<SavedView | ActionError> {
  const res = await api.PATCH("/api/projects/{id}/saved-views/{viewId}", {
    params: {
      path: { id: String(projectId), viewId: String(viewId) },
    },
    body: patch,
  });

  return toActionResult(res, "Failed to update view");
}
