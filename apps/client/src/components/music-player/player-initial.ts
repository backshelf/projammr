/**
 * What a player store starts with, handed in by whichever layout mounts the
 * player: the signed-in shell from its policies, the share page from the
 * defaults. Plain data, so a server layout builds it and hands it across to
 * `MusicPlayerProvider`.
 */

import type { PlayerPrefs } from "@/components/music-player/player-storage";
import type { LabSettings } from "@/lib/dsp/lab-settings";
import {
  DEFAULT_LAB_POLICY,
  labSettingsFrom,
  type LabPolicy,
} from "@/lib/policies/lab";
import { DEFAULT_PLAYBACK, type PlaybackPolicy } from "@/lib/policies/playback";

/** The rules a player store plays by. */
export type PlayerPolicy = { playback: PlaybackPolicy; lab: LabPolicy };

/**
 * `prefs` and `lab` are the values a browser with nothing stored starts
 * from; a browser's own stored live state (volume, mute, repeat, shuffle, the
 * Lab) overlays them field by field when the store is built. `policy` is the
 * rules the store starts with; `MusicPlayerProvider` keeps it following the
 * policies provider after that.
 */
export type PlayerInitial = {
  prefs: PlayerPrefs;
  lab: LabSettings;
  policy: PlayerPolicy;
};

/** The prefs a browser with nothing stored starts from under `playback`. */
const prefsFrom = (playback: PlaybackPolicy): PlayerPrefs => ({
  volume: playback.defaultVolume,
  muted: playback.startMuted,
  repeat: playback.repeat,
  shuffle: playback.shuffle,
});

/** A player store's starting point under `policy`. */
export function playerInitial({ playback, lab }: PlayerPolicy): PlayerInitial {
  return {
    prefs: prefsFrom(playback),
    lab: labSettingsFrom(lab),
    policy: { playback, lab },
  };
}

export const DEFAULT_PLAYER_INITIAL: PlayerInitial = playerInitial({
  playback: DEFAULT_PLAYBACK,
  lab: DEFAULT_LAB_POLICY,
});
