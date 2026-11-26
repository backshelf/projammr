"use server";

import type { TableQuery } from "@/actions/projects";
import type { CustomFieldParams } from "@/fields/custom-field";
import { serverApi } from "@/lib/server-api";
import { customFieldFilters } from "@/lib/table-params";
import { written } from "@/lib/write-action";
import {
  isActionError,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  GetTrack,
  Label,
  NewTrack,
  Track,
  TracksInCollection,
  TracksPage,
  TracksPageQuery,
  TrackSummary,
} from "@workspace/api/api";

export const getTracksForCollection = async (
  collectionId: number
): Promise<TracksInCollection | ActionError> => {
  const res = await serverApi.GET("/api/collections/{id}/tracks", {
    params: { path: { id: String(collectionId) } },
  });

  return toActionResult(res, "Failed to fetch tracks");
};

export const getTracksPageForProject = async (
  projectId: number,
  query: TableQuery &
    CustomFieldParams & {
      status?: number;
      collection?: number;
      relation?: string;
      label?: number;
      artist?: string;
      explicit?: string;
      archived?: TracksPageQuery["archived"];
    }
): Promise<TracksPage | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/tracks/paginated", {
    params: {
      path: { id: String(projectId) },
      query: {
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        q: query.q,
        groupBy: query.groupBy,
        status: query.status,
        priority: query.priority,
        collection: query.collection,
        relation: query.relation as never,
        label: query.label,
        artist: query.artist,
        explicit: query.explicit,
        archived: query.archived,
        ...customFieldFilters(query),
      } as never,
    },
  });

  return toActionResult(res, "Failed to fetch tracks");
};

export const getTrack = async (id: number): Promise<GetTrack | ActionError> => {
  const res = await serverApi.GET("/api/tracks/{id}", {
    params: { path: { id: String(id) } },
  });

  return toActionResult(res, "Failed to fetch track");
};

export const createTrack = async ({
  collectionId,
  trackPosition,
  ...newTrack
}: NewTrack & {
  collectionId?: number;
  trackPosition?: number;
}): Promise<
  (Track & { collectionId?: number; trackNumber?: number | null }) | ActionError
> => {
  const trackRes = await serverApi.POST("/api/tracks", {
    body: newTrack,
  });

  const track = await written(
    toActionResult<Track>(trackRes, "Failed to create track")
  );
  if (isActionError(track)) return track;

  if (!collectionId) return track;

  const collectionRes = await serverApi.POST("/api/collections/{id}/tracks", {
    params: { path: { id: String(collectionId) } },
    body: { trackId: track.id, trackNumber: trackPosition },
  });

  const collectionTrack = await written(
    toActionResult<{
      collectionId: number;
      trackNumber: number | null;
    }>(collectionRes, "Failed to add track to collection")
  );
  if (isActionError(collectionTrack)) return collectionTrack;

  return {
    ...track,
    collectionId: collectionTrack.collectionId,
    trackNumber: collectionTrack.trackNumber,
  };
};

/** Update a single track's number in a collection (swaps on conflict) */
export const updateTrackNumber = async (
  collectionId: number,
  trackId: number,
  trackNumber: number
): Promise<TracksInCollection | ActionError> => {
  const res = await serverApi.PATCH(
    "/api/collections/{id}/tracks/{trackId}/number",
    {
      params: {
        path: { id: String(collectionId), trackId: String(trackId) },
      },
      body: { trackNumber },
    }
  );

  return written(toActionResult(res, "Failed to update track number"));
};

/**
 * Every track in the project as an id, title, artists and artwork: live
 * tracks before archived ones, each most recently updated first. The pickers
 * and the sidebar's recently-edited list read this rather than the paginated
 * list, which hydrates each track with its sessions, collections, attachments
 * and relations.
 */
export const getTrackSummaries = async (
  projectId: number
): Promise<TrackSummary[] | ActionError> => {
  const res = await serverApi.GET("/api/projects/{id}/tracks/summary", {
    params: { path: { id: String(projectId) } },
  });

  return toActionResult(res, "Failed to fetch tracks");
};

/** A track's current labels, for reading its existing set before patching it. */
export const getTrackLabels = async (
  trackId: number
): Promise<Label[] | ActionError> => {
  const track = await getTrack(trackId);
  if (isActionError(track)) return track;

  return track.labels;
};
