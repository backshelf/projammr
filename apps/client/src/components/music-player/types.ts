import type {
  Artwork,
  Asset,
  AudioOwner,
  EntityKind,
} from "@workspace/api/api";

/**
 * The surface a player leaf is drawn on: the desktop card, or the
 * full-screen now-playing view whose controls are sized for a thumb.
 */
export type PlayerSize = "card" | "full";

export type MusicPlayerOwnerType = EntityKind;

/**
 * What the player needs of an asset: the identity it matches a loaded track
 * by, the name it falls back to, and where to fetch the bytes. Deliberately
 * narrower than a stored `Asset` row, because a share link serves its audio
 * through its own token-gated route and a guest never sees the row behind it.
 */
export type PlayableAsset = Pick<Asset, "id" | "name" | "assetPath">;

export type MusicPlayerTrack = {
  title?: string;
  artists?: string[];
  album?: string;
  cover?: string;
  ownerType: MusicPlayerOwnerType;
  ownerId: number;
  projectId?: number;
  collectionId?: number;
  asset: PlayableAsset;
  trackAudio?: {
    id: number;
    version: number;
    isPrimary: boolean;
    /** Integrated loudness (LUFS), for level-matching an A/B comparison. */
    lufs?: number | null;
  };
  /**
   * Accent bin of the resolved cover — a bare hue plus chroma, straight off
   * the `images` row. The player turns this into its local `--art` so its
   * tint follows the playing track rather than the page.
   */
  accentHue?: number | null;
  accentChroma?: number | null;
  /**
   * Set when the response that produced this track already described it, so
   * the metadata loader has nothing left to fetch for it.
   */
  metadataResolved?: boolean;
};

/** The cover fields of a {@link MusicPlayerTrack}, from a resolved artwork. */
export const coverFields = (artwork: Artwork | null | undefined) => ({
  cover: artwork?.assetPath,
  accentHue: artwork?.accentHue ?? null,
  accentChroma: artwork?.accentChroma ?? null,
});

/**
 * The player's view of a queued audio, from the `owner` the audio endpoints
 * send alongside it.
 */
export const fromAudioOwner = (owner: AudioOwner | null | undefined) =>
  owner
    ? {
        title: owner.title,
        artists: owner.artists,
        album: owner.album ?? undefined,
        projectId: owner.projectId ?? undefined,
        collectionId: owner.collectionId ?? undefined,
        metadataResolved: true,
        ...coverFields(owner.artwork),
      }
    : {};

export type MusicPlayerMetadata = Omit<MusicPlayerTrack, "asset">;

export type RepeatMode = "off" | "one" | "all";

export const trackLabel = (track: MusicPlayerTrack) =>
  track.title || track.asset.name;

export const artistLabel = (track: MusicPlayerTrack) =>
  track.artists?.join(", ") ?? "";

export const versionLabel = (track: MusicPlayerTrack) =>
  track.trackAudio ? `v${track.trackAudio.version}` : "";
