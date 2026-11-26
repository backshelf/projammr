"use client";

import type { BulkSelection } from "@/entities/api";
import { requestTracksArchived } from "@/entities/track/api";
import type { TableActionResult } from "@/components/tables/generic-table-types";
import { browserApi } from "@/lib/browser-api";
import {
  applyMutation,
  defineMutation,
  type MutationRouter,
} from "@/lib/mutation";
import { isActionError } from "@workspace/api/lib/action-result";
import { pluralizeCount } from "@workspace/session-diff/format";

type ArchiveInput = {
  projectId: number;
  selection: BulkSelection;
  /** Names the track in the message when exactly one changed. */
  title?: string;
  /** Refreshed once the request succeeds; the same one serves the Undo. */
  router: MutationRouter;
};

function archivedMessage(
  title: string | undefined,
  changed: number,
  sessionCount: number
): string {
  if (title === undefined || changed !== 1) {
    return `Archived ${pluralizeCount(changed, "track")}`;
  }
  if (sessionCount === 0) return `Archived ${title}`;
  return sessionCount === 1
    ? `Archived ${title} and its session`
    : `Archived ${title} and its ${sessionCount} sessions`;
}

function unarchivedMessage(title: string | undefined, changed: number): string {
  return title !== undefined && changed === 1
    ? `Unarchived ${title}`
    : `Unarchived ${pluralizeCount(changed, "track")}`;
}

async function setTracksArchived(
  archived: boolean,
  { projectId, selection, title, router }: ArchiveInput
): Promise<TableActionResult> {
  const result = await applyMutation(
    defineMutation(
      () => requestTracksArchived(browserApi, projectId, selection, archived),
      ["route"]
    ),
    router
  );
  if (isActionError(result)) return { ok: false, message: result.error };

  const { ids, sessionCount } = result;
  if (ids.length === 0) {
    return {
      ok: true,
      message: archived ? "No tracks to archive" : "No tracks to unarchive",
    };
  }

  return {
    ok: true,
    message: archived
      ? archivedMessage(title, ids.length, sessionCount)
      : unarchivedMessage(title, ids.length),
    undo: () =>
      setTracksArchived(!archived, {
        projectId,
        selection: { ids },
        title,
        router,
      }),
  };
}

/** Archives the selected tracks; the result's Undo unarchives exactly those that changed. */
export const archiveTracks = (input: ArchiveInput) =>
  setTracksArchived(true, input);

/** Unarchives the selected tracks; the result's Undo archives exactly those that changed. */
export const unarchiveTracks = (input: ArchiveInput) =>
  setTracksArchived(false, input);
