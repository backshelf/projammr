"use server";

import { getCollection } from "@/actions/collections";
import { getProject } from "@/actions/projects";
import { getSession } from "@/actions/sessions";
import { getTrack } from "@/actions/tracks";
import {
  coverFields,
  MusicPlayerMetadata,
} from "@/components/music-player/types";
import { isActionError } from "@workspace/api/lib/action-result";
import type { EntityKind } from "@workspace/api/api";

type PlayerMetadataLoader = (
  ownerId: number
) => Promise<Omit<MusicPlayerMetadata, "ownerId" | "ownerType"> | undefined>;

/**
 * How each owner kind resolves the fields the player shows for it. Every read
 * carries its own resolved `artwork`, so a lookup is one request: no image
 * list to match a cover path against, and no accent maths repeated here.
 */
const METADATA_LOADERS = {
  async track(ownerId) {
    const track = await getTrack(ownerId);
    if (isActionError(track)) return;
    return {
      title: track.title,
      artists: track.artists,
      album: track.collections[0]?.title || undefined,
      projectId: track.projectId ?? undefined,
      collectionId: track.collections[0]?.id,
      ...coverFields(track.artwork),
    };
  },
  async collection(ownerId) {
    const collection = await getCollection(ownerId);
    if (isActionError(collection)) return;
    return {
      album: collection.title,
      projectId: collection.projectId ?? undefined,
      collectionId: collection.id,
      ...coverFields(collection.artwork),
    };
  },
  async session(ownerId) {
    const session = await getSession(ownerId);
    if (isActionError(session)) return;

    const track = session.track;
    return {
      title: track?.title || session.name,
      artists: track?.artists,
      album: track?.collections[0]?.title || undefined,
      projectId: session.projectId ?? track?.projectId ?? undefined,
      collectionId: track?.collections[0]?.id,
      ...coverFields(session.artwork),
    };
  },
  async project(ownerId) {
    const project = await getProject(ownerId);
    if (isActionError(project)) return;
    return {
      artists: [project.name],
      projectId: project.id,
      ...coverFields(project.artwork),
    };
  },
} satisfies Record<EntityKind, PlayerMetadataLoader>;

/**
 * Metadata for a queued item the audio endpoints did not describe — an audio
 * attachment played straight off an entity page, which carries no owner row.
 */
export const getMusicPlayerMetadata = async (
  input: Pick<MusicPlayerMetadata, "ownerType" | "ownerId">
): Promise<MusicPlayerMetadata | undefined> => {
  const fields = await METADATA_LOADERS[input.ownerType](input.ownerId);
  if (!fields) return;
  return { ...fields, ownerType: input.ownerType, ownerId: input.ownerId };
};
