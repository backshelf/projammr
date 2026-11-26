"use client";

import { collectionTable } from "@/entities/collection/table";
import { sessionTable } from "@/entities/session/table";
import type { EntityTableDefinition } from "@/entities/table-types";
import { trackTable } from "@/entities/track/table";
import type { TableEntityKind } from "@workspace/api/api";

/**
 * The client's table definitions, one per table kind. Client-only: a
 * definition builds columns and hooks, so `<kind>/index.ts` and the registry in
 * `entities/index.ts` never import this file.
 */
const ENTITY_TABLES: {
  [K in TableEntityKind]: EntityTableDefinition<K>;
} = {
  track: trackTable,
  session: sessionTable,
  collection: collectionTable,
};

/** The definition for `kind`, typed for that kind. */
export const entityTable = <K extends TableEntityKind>(
  kind: K
): EntityTableDefinition<K> => ENTITY_TABLES[kind];
