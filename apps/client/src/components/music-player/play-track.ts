import {
  fromAudioOwner,
  MusicPlayerTrack,
} from "@/components/music-player/types";
import {
  clientGetCollectionPrimaryAudios,
  clientGetTrackAttachments,
  clientGetTrackAudios,
} from "@/lib/client-api";
import type { PlaybackPolicy, VersionToPlay } from "@/lib/policies/playback";
import type { PlayableTrackAudio } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { isAudioFileName } from "@workspace/api/lib/upload";
import { toast } from "sonner";

/** What playing a track reads from the playback policy. */
export type TrackPlayPolicy = Pick<
  PlaybackPolicy,
  "versionToPlay" | "noAudioFallback"
>;

const latest = (audios: PlayableTrackAudio[]) =>
  audios.reduce((best, audio) => (audio.version > best.version ? audio : best));

const VERSION_PICKS: Record<
  VersionToPlay,
  (audios: PlayableTrackAudio[]) => PlayableTrackAudio
> = {
  primary: (audios) =>
    audios.find((audio) => audio.isPrimary) ?? latest(audios),
  latest,
};

/** The version `choice` plays out of a track's non-empty list of versions. */
export const chooseVersion = (
  audios: PlayableTrackAudio[],
  choice: VersionToPlay
): PlayableTrackAudio => VERSION_PICKS[choice](audios);

/** The player's track for one version of track `trackId`. */
export function audioToPlayable(
  trackId: number,
  audio: PlayableTrackAudio,
  title?: string
): MusicPlayerTrack {
  return {
    asset: audio.asset,
    ownerType: "track",
    ownerId: trackId,
    title,
    ...fromAudioOwner(audio.owner),
    trackAudio: {
      id: audio.id,
      version: audio.version,
      isPrimary: audio.isPrimary,
    },
  };
}

/**
 * What playing track `trackId` plays: the version `policy` picks, else (with
 * no track audio at all) the newest audio attachment where the policy falls
 * back to one. Null, having said why, when there is nothing to play.
 */
export async function trackToPlayable(
  trackId: number,
  policy: TrackPlayPolicy,
  title?: string
): Promise<MusicPlayerTrack[] | null> {
  const audios = await clientGetTrackAudios(trackId);
  if (isActionError(audios)) {
    toast.error("Could not load track audio");
    return null;
  }

  if (audios.length > 0) {
    return [
      audioToPlayable(
        trackId,
        chooseVersion(audios, policy.versionToPlay),
        title
      ),
    ];
  }

  const noAudio = () => {
    toast.error(`${title ?? "This track"} has no audio`);
    return null;
  };
  if (policy.noAudioFallback === "none") return noAudio();

  const attachments = await clientGetTrackAttachments(trackId);
  if (isActionError(attachments)) {
    toast.error("Could not load track audio");
    return null;
  }

  const audioAttachments = attachments.filter((a) => isAudioFileName(a.name));
  if (audioAttachments.length === 0) return noAudio();

  const newest = [...audioAttachments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )[0]!;
  toast("No track audio set — playing the newest audio attachment");

  return [{ asset: newest, ownerType: "track", ownerId: trackId, title }];
}

/** What playing collection `collectionId` plays: each track's `versionToPlay` version. */
export async function collectionToPlayable(
  collectionId: number,
  versionToPlay: VersionToPlay
): Promise<MusicPlayerTrack[] | null> {
  const audios = await clientGetCollectionPrimaryAudios(
    collectionId,
    versionToPlay
  );
  if (isActionError(audios)) {
    toast.error("Could not load collection audio");
    return null;
  }

  if (audios.length === 0) {
    toast.error("This collection has no playable tracks");
    return null;
  }

  return audios.map(({ trackId, trackAudio, owner, ...asset }) => ({
    asset,
    ownerType: "track" as const,
    ownerId: trackId,
    trackAudio,
    ...fromAudioOwner(owner),
  }));
}
