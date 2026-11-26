"use server";

import {
  patchEntity,
  type PatchableEntity,
  type PatchedEntity,
} from "@/actions/patch-field";
import type { ActionError } from "@workspace/api/api";

/**
 * Every rich-text field is `jsonb`, so the editor's serialized string is
 * parsed back into a value before it's sent — sending the string itself
 * would nest it as a JSON-encoded string inside the column instead of
 * storing the parsed document.
 */
export const saveRichText = async (
  entityType: PatchableEntity,
  entityId: number,
  fieldName: string,
  content: string
): Promise<PatchedEntity | ActionError> => {
  return patchEntity(entityType, entityId, {
    [fieldName]: JSON.parse(content),
  });
};
