"use client";

import { patchField, type PatchableEntity } from "@/actions/patch-field";
import { isActionError } from "@workspace/api/lib/action-result";
import { useCallback, useState, type KeyboardEvent } from "react";

/**
 * Sentinel a `prepare` returns to save an actual `null`, distinct from the
 * bare `null` return that refuses the save and keeps the editor open.
 */
export const CLEAR = Symbol("useInlineEdit.clear");

export type InlineEditOptions = {
  entityType: PatchableEntity;
  entityId: number;
  fieldName: string;
  /** The value the server last reported; the draft starts and resets here. */
  value: string;
  /**
   * Turns the trimmed draft into what gets sent. Returning `null` refuses the
   * save and leaves the editor open, which is how a field says "not blank".
   * Return `CLEAR` to save `null` instead.
   */
  prepare?: (draft: string) => string | number | null | typeof CLEAR;
};

const nonEmpty = (draft: string) => (draft ? draft : null);

/**
 * The edit state machine the masthead title and the rail properties share: a
 * draft seeded from the server's value, a save that patches one field (the
 * action's own response re-renders the route), and Enter/Escape while the
 * input has focus.
 */
export function useInlineEdit({
  entityType,
  entityId,
  fieldName,
  value,
  prepare = nonEmpty,
}: InlineEditOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(() => {
    setDraft(value);
    setError(null);
    setIsEditing(true);
  }, [value]);

  const cancel = useCallback(() => {
    setDraft(value);
    setError(null);
    setIsEditing(false);
  }, [value]);

  const submit = useCallback(async () => {
    const prepared = prepare(draft.trim());
    if (prepared === null) return;

    setIsSaving(true);
    try {
      const result = await patchField(
        entityType,
        entityId,
        fieldName,
        prepared === CLEAR ? null : prepared
      );
      if (isActionError(result)) {
        setError(result.error);
      } else {
        setIsEditing(false);
        setError(null);
      }
    } catch {
      setError("Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [draft, prepare, entityType, entityId, fieldName]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        cancel();
      }
    },
    [submit, cancel]
  );

  return {
    isEditing,
    isSaving,
    draft,
    error,
    setDraft,
    begin,
    cancel,
    submit,
    onKeyDown,
  };
}
