import type { EntityKind } from "@workspace/api/api";
import { collection } from "@/entities/collection";
import { project } from "@/entities/project";
import { session } from "@/entities/session";
import { track } from "@/entities/track";
import type { EntityModule } from "@/entities/types";

/**
 * The client's entity registry. Every kind is one module that says what it is; a
 * consumer looks a kind up here instead of switching on it. Adding a kind is a
 * directory and a line in this object.
 *
 * Everything reachable from this file is safe to import from a client component.
 */
export const ENTITIES = {
  project,
  collection,
  track,
  session,
} as const satisfies {
  [K in EntityKind]: EntityModule<K>;
};

/**
 * The kinds whose module declares a status (`hasStatus: true`). Filters the
 * literal per-module values rather than `EntityModule<K>`'s own `hasStatus:
 * boolean`, so a kind's module is the only place that has to say it carries a
 * status.
 */
export type StatusKind = {
  [K in EntityKind]: (typeof ENTITIES)[K]["hasStatus"] extends true ? K : never;
}[EntityKind];

const REGISTRY: { [K in EntityKind]: EntityModule<K> } = ENTITIES;

export const entityModule = <K extends EntityKind>(kind: K): EntityModule<K> =>
  REGISTRY[kind];

export const isEntityKind = (value: string): value is EntityKind =>
  value in ENTITIES;
