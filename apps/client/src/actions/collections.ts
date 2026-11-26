"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import {
  ActionError,
  Collection,
  CollectionTotalStatus,
  GetCollection,
  NewCollection,
} from "@workspace/api/api";

export const createCollection = async (
  newCollection: NewCollection
): Promise<Collection | ActionError> => {
  const res = await serverApi.POST("/api/collections", { body: newCollection });

  return written(toActionResult(res, "Failed to create collection"));
};

export const getCollection = async (
  collectionId: number
): Promise<GetCollection | ActionError> => {
  const res = await serverApi.GET("/api/collections/{id}", {
    params: { path: { id: String(collectionId) } },
  });

  return toActionResult(res, "Failed to fetch collection");
};

export const getCollectionTotalStatus = async (
  collectionId: number
): Promise<CollectionTotalStatus | ActionError> => {
  const res = await serverApi.GET("/api/collections/{id}/status", {
    params: { path: { id: String(collectionId) } },
  });

  return toActionResult(res, "Failed to fetch collection status");
};

export const removeTrackFromCollection = async (
  collectionId: number,
  trackId: number
): Promise<{ success: boolean } | ActionError> => {
  const res = await serverApi.DELETE("/api/collections/{id}/tracks/{trackId}", {
    params: {
      path: { id: String(collectionId), trackId: String(trackId) },
    },
  });

  return written(
    toActionOutcome(res, "Failed to remove track from collection", {
      success: true,
    })
  );
};
