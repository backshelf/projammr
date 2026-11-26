"use client";

import { browserApi } from "@/lib/browser-api";
import type { NewNote, NotePatch } from "@workspace/api/api";

/*
 * The autosave path for the notebook editor. These bypass Server Actions
 * because the editor's save queue fires on every debounced keystroke burst —
 * a hot loop `toActionResult` is not built for, since a stale-version PATCH
 * (or a link onto a track that already has a note) answers 409 and the
 * editor needs that status to lock and offer a reload, which `toActionResult`
 * would collapse into an indistinguishable `{ error }`. So these return
 * openapi-fetch's raw `{ data, error, response }` and the caller reads
 * `response.status` itself.
 */

export const createNoteClient = (input: NewNote) =>
  browserApi.POST("/api/notes", { body: input });

export const saveNoteClient = (
  id: number,
  version: number,
  patch: Omit<NotePatch, "version">
) =>
  browserApi.PATCH("/api/notes/{id}", {
    params: { path: { id: String(id) } },
    body: { version, ...patch },
  });

export const getNoteTextClient = (id: number) =>
  browserApi.GET("/api/notes/{id}/text", {
    params: { path: { id: String(id) } },
  });
