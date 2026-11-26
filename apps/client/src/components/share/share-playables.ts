import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { SharelinkTrack } from "@workspace/api/api";

/**
 * A share serves its own media: the token in the path is the whole credential,
 * so both URLs point at the share's routes rather than at `/media`, which
 * would ask for a project membership the reader does not have.
 */
const shareStreamUrl = (token: string, trackAudioId: number) =>
  `/share/${encodeURIComponent(token)}/stream?id=${trackAudioId}`;

export const shareCoverUrl = (token: string, trackAudioId: number) =>
  `/share/${encodeURIComponent(token)}/cover/${trackAudioId}`;

/** One shared track as everything the page draws it with: the queue entry, the
 *  ids its waveform and thread hang off, and the peaks that came with it. */
export type ShareEntry = {
  title: string;
  trackAudioId: number;
  assetId: number;
  peaks: number[];
  playable: MusicPlayerTrack;
  /** Which mix this is, when the server knows — `null` rather than a
   *  synthetic default, so a caller that cannot name the version can fall
   *  back to `createdAt` instead of showing a made-up "v1". */
  version: number | null;
  /** When this audio was added, for a listener to tell mixes apart by date
   *  where there is no meaningful version number. */
  createdAt: string | null;
  /** Playing length in milliseconds, or `null` before it has been probed. */
  durationMs: number | null;
};

/**
 * The share's tracks as player queue entries. `metadataResolved` stops the
 * metadata loader reaching for the project endpoints behind each track — the
 * share response is already everything a reader is allowed to know, and the
 * peaks ride along with it rather than being fetched.
 *
 * A track with no audio behind it is dropped rather than queued as a gap.
 */
export function shareEntries(
  token: string,
  tracks: SharelinkTrack[]
): ShareEntry[] {
  return tracks.flatMap((track) => {
    const audio = track.trackAudio;
    if (audio.id == null || audio.assetId == null) return [];

    const title = track.title ?? audio.name ?? "Untitled";

    return [
      {
        title,
        trackAudioId: audio.id,
        assetId: audio.assetId,
        peaks: audio.audioPeaks ?? [],
        version: audio.version ?? null,
        createdAt: audio.createdAt ?? null,
        durationMs: audio.durationMs ?? null,
        playable: {
          title,
          cover: track.artwork ? shareCoverUrl(token, audio.id) : undefined,
          accentHue: track.artwork?.accentHue ?? null,
          accentChroma: track.artwork?.accentChroma ?? null,
          ownerType: "track" as const,
          ownerId: audio.trackId ?? track.id,
          asset: {
            id: audio.assetId,
            name: audio.name ?? title,
            assetPath: shareStreamUrl(token, audio.id),
          },
          trackAudio: {
            id: audio.id,
            version: audio.version ?? 1,
            isPrimary: audio.isPrimary ?? true,
            lufs: audio.lufs,
          },
          metadataResolved: true,
        },
      },
    ];
  });
}
