"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import { ActionError, NoteDetail, NoteSummary } from "@workspace/api/api";

export const getMyNotes = async (): Promise<NoteSummary[] | ActionError> => {
  const res = await serverApi.GET("/api/notes");

  return toActionResult(res, "Failed to fetch notes");
};

export const getNote = async (
  id: number
): Promise<NoteDetail | ActionError> => {
  const res = await serverApi.GET("/api/notes/{id}", {
    params: { path: { id: String(id) } },
  });

  return toActionResult(res, "Failed to fetch note");
};

export const deleteNote = async (
  id: number
): Promise<{ success: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/notes/{id}", {
    params: { path: { id: String(id) } },
  });

  return toActionOutcome(res, "Failed to delete note", {
    success: true,
  } as const);
};

export const linkNote = async (
  id: number,
  trackId: number
): Promise<NoteDetail | ActionError> => {
  const res = await serverApi.POST("/api/notes/{id}/link", {
    params: { path: { id: String(id) } },
    body: { trackId },
  });

  return written(toActionResult(res, "Failed to link note"));
};

export const unlinkNote = async (
  id: number
): Promise<NoteDetail | ActionError> => {
  const res = await serverApi.POST("/api/notes/{id}/unlink", {
    params: { path: { id: String(id) } },
  });

  return written(toActionResult(res, "Failed to unlink note"));
};
