"use client";

import { ENTITIES } from "@/entities";
import {
  ENTITY_API,
  type BulkSelection,
  type NewOf,
  type RowOf,
} from "@/entities/api";
import { linkTracks } from "@/entities/collection/api";
import {
  createSavedView as createSavedViewCall,
  deleteSavedView as deleteSavedViewCall,
  updateSavedView as updateSavedViewCall,
} from "@/entities/project/api";
import { addRelation, removeRelation } from "@/entities/track/api";
import { fieldWriteBody } from "@/fields/custom-field";
import { browserApi } from "@/lib/browser-api";
import { defineMutation, type InvalidationKey } from "@/lib/mutation";
import type { ApiClient } from "@workspace/api/lib/authed-client";
import type {
  ActionError,
  EntityKind,
  SavedViewKind,
  TableEntityKind,
} from "@workspace/api/api";

/** A value a table cell or a page control can write to a field. */
export type PatchFieldValue = string | number | boolean | null | string[];

/**
 * A `statusId` edit refreshes the route on a kind that has a status, because
 * status feeds server-rendered rollups an optimistic row can't reach. Any
 * other field edit is optimistic in the table, so it refreshes nothing.
 */
const onCellEdit = (
  kind: EntityKind,
  field: string
): readonly InvalidationKey[] =>
  ENTITIES[kind].hasStatus && field === "statusId" ? ["route"] : [];

/** One table cell. Optimistic in the table, so it refreshes only when the field feeds a server-rendered rollup. */
export const patchEntityField = (
  kind: EntityKind,
  id: number,
  field: string,
  value: PatchFieldValue
) =>
  defineMutation(
    () => ENTITY_API[kind].patch(browserApi, id, fieldWriteBody(field, value)),
    onCellEdit(kind, field)
  );

/** A control on an entity page. Nothing on the page is optimistic, so it always refreshes. */
export const patchEntityFields = (
  kind: EntityKind,
  id: number,
  body: Record<string, unknown>
) =>
  defineMutation(() => ENTITY_API[kind].patch(browserApi, id, body), ["route"]);

/** `invalidates` is `[]` when the caller follows the create with a mutation that refreshes. */
export const createEntity = <K extends TableEntityKind>(
  kind: K,
  payload: NewOf[K],
  invalidates: readonly InvalidationKey[] = ["route"]
) =>
  defineMutation(
    // A generic `kind` widens `ENTITY_API[kind]` to a union across the table
    // kinds, which TypeScript will not call with one kind's payload. The
    // assertion re-narrows the call to the pairing the signature already fixed,
    // so the mutation still resolves to this kind's own row.
    () =>
      (
        ENTITY_API[kind].create as (
          api: ApiClient,
          payload: NewOf[K]
        ) => Promise<RowOf[K] | ActionError>
      )(browserApi, payload),
    invalidates
  );

/** Deletes a row (or a project). */
export const removeEntity = (kind: EntityKind, id: number) =>
  defineMutation(() => ENTITY_API[kind].remove(browserApi, id), ["route"]);

/** Patches every row in a bulk selection. */
export const bulkPatchEntities = (
  kind: TableEntityKind,
  projectId: number,
  selection: BulkSelection,
  patch: Record<string, unknown>
) =>
  defineMutation(
    () => ENTITY_API[kind].bulkPatch(browserApi, projectId, selection, patch),
    ["route"]
  );

/** Deletes every row in a bulk selection. */
export const bulkRemoveEntities = (
  kind: TableEntityKind,
  projectId: number,
  selection: BulkSelection
) =>
  defineMutation(
    () => ENTITY_API[kind].bulkRemove(browserApi, projectId, selection),
    ["route"]
  );

/** Adds or removes labels across every row in a bulk selection. */
export const bulkSetEntityLabels = (
  kind: TableEntityKind,
  projectId: number,
  selection: BulkSelection,
  labels: { add: number[]; remove: number[] }
) =>
  defineMutation(
    () =>
      ENTITY_API[kind].bulkSetLabels(browserApi, projectId, selection, labels),
    ["route"]
  );

/** Moves every row in a bulk selection to another project. */
export const bulkMoveEntities = (
  kind: TableEntityKind,
  projectId: number,
  selection: BulkSelection,
  targetProjectId: number
) =>
  defineMutation(
    () =>
      ENTITY_API[kind].bulkMove(
        browserApi,
        projectId,
        selection,
        targetProjectId
      ),
    ["route"]
  );

/** Sets a row's labels, by id or by name. */
export const setEntityLabels = (
  kind: TableEntityKind,
  id: number,
  input: { labelIds?: number[]; names?: string[] }
) =>
  defineMutation(
    () => ENTITY_API[kind].setLabels(browserApi, id, input),
    ["route"]
  );

/** Moves a row to another project. the `DataTable` root navigates to its new href afterwards, so nothing refreshes here. */
export const moveEntity = (
  kind: TableEntityKind,
  id: number,
  projectId: number
) => defineMutation(() => ENTITY_API[kind].move(browserApi, id, projectId), []);

/** Adds tracks to a collection. */
export const linkTracksToCollection = (
  collectionId: number,
  trackIds: number[]
) =>
  defineMutation(
    () => linkTracks(browserApi, collectionId, trackIds),
    ["route", "collection-tracks"]
  );

/** Relates `fromTrackId` as a derivative of `toTrackId`. */
export const addTrackRelation = (
  fromTrackId: number,
  toTrackId: number,
  relationTypeId: number
) =>
  defineMutation(
    () => addRelation(browserApi, fromTrackId, toTrackId, relationTypeId),
    ["route"]
  );

/** Removes a relation touching `trackId`, by relation id. */
export const removeTrackRelation = (trackId: number, relationId: number) =>
  defineMutation(
    () => removeRelation(browserApi, trackId, relationId),
    ["route"]
  );

/** Saves a query as a named view on a project. */
export const createSavedView = (
  projectId: number,
  kind: SavedViewKind,
  name: string,
  query: string
) =>
  defineMutation(
    () => createSavedViewCall(browserApi, projectId, kind, name, query),
    ["route"]
  );

/** Deletes a saved view. */
export const deleteSavedView = (projectId: number, viewId: number) =>
  defineMutation(
    () => deleteSavedViewCall(browserApi, projectId, viewId),
    ["route"]
  );

/** Shares or unshares a saved view; only its owner may change this. */
export const updateSavedView = (
  projectId: number,
  viewId: number,
  patch: { shared: boolean }
) =>
  defineMutation(
    () => updateSavedViewCall(browserApi, projectId, viewId, patch),
    ["route"]
  );

/**
 * Notifies the collection's client-held track list without calling the API,
 * for a caller whose write was a server action: that already refreshed the
 * route through `written()`, but a server action can't reach a client-held
 * list, so this is the only way left to tell it.
 */
export const collectionTracksChanged = () =>
  defineMutation(async () => ({ ok: true }) as const, ["collection-tracks"]);
