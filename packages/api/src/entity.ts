import type { EntityKind } from "./enums";

export type { EntityKind };

/** The kinds that carry labels, bulk operations and rows in a table. */
export type TableEntityKind = Exclude<EntityKind, "project">;
