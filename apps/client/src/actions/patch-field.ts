"use server";

import { fieldWriteBody } from "@/fields/custom-field";
import { serverApi } from "@/lib/server-api";
import { written } from "@/lib/write-action";
import { ENTITY_API } from "@/entities/api";
import type { ActionError, EntityKind } from "@workspace/api/api";

export type PatchFieldValue = string | number | boolean | null | unknown[];

export type PatchableEntity = EntityKind;

/**
 * The patched row as the API echoes it back. The four routes return different
 * entities and the field being written is only known at runtime, so callers
 * that need a specific field read it from a typed refetch instead.
 */
export type PatchedEntity = Record<string, unknown>;

/**
 * Writes one field of an entity: a column by its name, or a custom field by its
 * `cf_<id>` key, which travels in the `fields` bag. The field name and value
 * arrive from a generic inline editor, so the body is built dynamically and the
 * typed client's per-route body type is bypassed at this one boundary.
 */
export async function patchField(
  entityType: PatchableEntity,
  entityId: number,
  fieldName: string,
  value: PatchFieldValue
): Promise<PatchedEntity | ActionError> {
  return written(
    patchEntity(entityType, entityId, fieldWriteBody(fieldName, value))
  );
}

/**
 * The patch itself, which does not refresh the route: `save-description.ts`
 * autosaves a rich-text field on a debounce while the user is still typing,
 * and re-rendering the page on every pause is the cost `Description` is built
 * to avoid. A caller that wants the route back goes through `patchField`.
 */
export async function patchEntity(
  entityType: PatchableEntity,
  entityId: number,
  body: Record<string, unknown>
): Promise<PatchedEntity | ActionError> {
  return ENTITY_API[entityType].patch(serverApi, entityId, body);
}
