"use server";

import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import {
  toActionOutcome,
  toActionResult,
} from "@workspace/api/lib/action-result";
import type {
  ActionError,
  CandidateAudio,
  LinkTrackAudiosResult,
} from "@workspace/api/api";

export const linkTrackAudios = async (
  trackId: number,
  assetIds: number[]
): Promise<LinkTrackAudiosResult | ActionError> => {
  const res = await serverApi.POST("/api/tracks/{id}/audios", {
    params: { path: { id: String(trackId) } },
    body: { assetIds },
  });

  return written(toActionResult(res, "Failed to link audio"));
};

export const unlinkTrackAudio = async (
  trackAudioId: number
): Promise<{ ok: true } | ActionError> => {
  const res = await serverApi.DELETE("/api/track-audios/{id}", {
    params: { path: { id: String(trackAudioId) } },
  });

  return written(
    toActionOutcome(res, "Failed to unlink audio", { ok: true } as const)
  );
};

export const setPrimaryTrackAudio = async (
  trackAudioId: number
): Promise<{ ok: true } | ActionError> => {
  const res = await serverApi.PATCH("/api/track-audios/{id}/primary", {
    params: { path: { id: String(trackAudioId) } },
  });

  return written(
    toActionOutcome(res, "Failed to set primary audio", {
      ok: true,
    } as const)
  );
};

export const getCandidateAudios = async (
  trackId: number
): Promise<CandidateAudio[] | ActionError> => {
  const res = await serverApi.GET("/api/tracks/{id}/candidate-audios", {
    params: { path: { id: String(trackId) } },
  });

  return toActionResult(res, "Failed to fetch candidate audio");
};
