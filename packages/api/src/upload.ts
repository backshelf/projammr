import { IMAGE_TYPES } from "@workspace/settings/groups/instance-limits";
import { AUDIO_EXTENSIONS } from "./enums";

export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** The `accept` attribute for an audio file input. */
export const AUDIO_ACCEPT = [...AUDIO_EXTENSIONS, "audio/*"].join(",");

export const isAudioFileName = (name: string) => {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
};
