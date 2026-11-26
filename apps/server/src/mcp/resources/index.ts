import { AUDIO_RESOURCES } from "./audio.js";
import { NOTES_RESOURCES } from "./notes.js";
import { RESOURCES as READ_RESOURCES } from "./read.js";

/**
 * Every resource the registry exposes, concatenated from its module in
 * registration order. Adding a resource is adding a module's array here,
 * never editing the registry.
 */
export const RESOURCES = [
  ...READ_RESOURCES,
  ...NOTES_RESOURCES,
  ...AUDIO_RESOURCES,
];
