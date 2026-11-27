import type { AnyToolSpec } from "../spec.js";
import { AUDIO_TOOLS } from "./audio.js";
import { IMAGE_TOOLS } from "./images.js";
import { MACHINE_TOOLS } from "./machines.js";
import { NOTES_TOOLS } from "./notes.js";
import { ORGANISE_TOOLS } from "./organise.js";
import { READ_TOOLS } from "./read.js";
import { REPO_TOOLS } from "./repos.js";

/**
 * Every tool the registry exposes, concatenated from its module in the order
 * that keeps `tools/list` deterministic. Adding a tool is adding a module's
 * array here, never editing the registry.
 */
export const TOOLS: AnyToolSpec[] = [
  ...READ_TOOLS,
  ...REPO_TOOLS,
  ...MACHINE_TOOLS,
  ...ORGANISE_TOOLS,
  ...IMAGE_TOOLS,
  ...NOTES_TOOLS,
  ...AUDIO_TOOLS,
];
