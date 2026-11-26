import { collection } from "./collection/index.js";
import { project } from "./project/index.js";
import { session } from "./session/index.js";
import { trackAudioTarget } from "./track-audio/index.js";
import { track } from "./track/index.js";
import type {
  CommentTarget,
  CommentTargetKind,
  EntityKind,
  EntityModule,
} from "./types.js";

/**
 * The entity registry.
 *
 * Every entity is one module that says what it is; nothing outside a module
 * names a kind. Adding a fifth entity is a directory and a line here — no
 * consumer changes, because none of them switches on the kind.
 *
 * This file deliberately holds no routers. The query layer reads the registry
 * (comments, activity, images, assets, search), and routes read the query
 * layer, so a registry that imported routers would close that loop. Mounting
 * lives in `src/routes/entities.ts`.
 */
export const ENTITIES = {
  project,
  collection,
  track,
  session,
} as const satisfies Record<EntityKind, EntityModule>;

export const entityModules = (): EntityModule[] => Object.values(ENTITIES);

/** Everything a comment can hang off: the entities plus the audio version. */
export const COMMENT_TARGETS: Record<CommentTargetKind, CommentTarget> = {
  ...ENTITIES,
  track_audio: trackAudioTarget,
};

export const isEntityKind = (value: string): value is EntityKind =>
  value in ENTITIES;

export type { EntityKind, EntityModule, CommentTarget, CommentTargetKind };
