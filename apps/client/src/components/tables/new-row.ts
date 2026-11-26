/**
 * Config and validation for a table's inline "create" row. A table declares
 * which columns are draft inputs and which of those are required; the shared
 * draft row in DataTable renders each field's kind's input and, on save,
 * parses every raw string with that kind to the value the create endpoint
 * expects.
 */

import { fieldKind } from "@/fields";
import type { FieldConfig, FieldKindName, FieldValue } from "@/fields/types";

/** A draft field: the kind that enters it and parses it, and that kind's config. */
export type NewRowFieldConfig = { type: FieldKindName } & FieldConfig;

/**
 * Draft fields derived from a table's editable-cell configs, so a column that
 * is editable and creatable declares its kind, placeholder, options and
 * vocabulary (statuses, priority levels) once. `ids` selects which columns take an input in the draft row;
 * `extras` adds fields that have no editable config: a draft-only field (a
 * seeded parent id) that is never a column, or a column that is not
 * editable but is still entered at creation (the identity column). An id in
 * `ids` that `extras` also names takes its config from `extras` and keeps its
 * place in `ids`; any other extra follows the listed ids.
 */
export function draftFieldsFrom(
  editable: Record<string, NewRowFieldConfig>,
  ids: string[],
  extras: Record<string, NewRowFieldConfig> = {}
): Record<string, NewRowFieldConfig> {
  const fields: Record<string, NewRowFieldConfig> = {};
  for (const id of ids) {
    const extra = extras[id];
    if (extra) {
      fields[id] = extra;
      continue;
    }
    const config = editable[id];
    if (!config) continue;
    fields[id] = {
      type: config.type,
      ...(config.placeholder != null
        ? { placeholder: config.placeholder }
        : {}),
      ...(config.required ? { required: true } : {}),
      ...(config.options ? { options: config.options } : {}),
      ...(config.suggestions ? { suggestions: config.suggestions } : {}),
      ...(config.statuses ? { statuses: config.statuses } : {}),
      ...(config.priorityLevels
        ? { priorityLevels: config.priorityLevels }
        : {}),
    };
  }
  return { ...fields, ...extras };
}

/** Draft values keyed by column id, as the raw editor produces them. */
export type DraftValues = Record<string, string>;

/** Parsed values keyed by column id, ready for the create payload. */
export type CoercedDraft = Record<string, FieldValue>;

/** Why one draft field cannot be saved. */
type DraftFieldError = { field: string; error: string };

export type ValidationResult =
  { ok: true; value: CoercedDraft } | { ok: false; errors: DraftFieldError[] };

/**
 * Parse every declared field with its kind. A field that fails reports the
 * kind's own message (a required blank reads "Required", a malformed value what
 * is wrong with it), and `errors` is in declaration order so the message reads
 * predictably. A blank optional field is `null`.
 *
 * `initialValues` (keyed by column id, already parsed) seed fields the user
 * has not touched — e.g. a group-header draft row pre-filled with that group's
 * value. A seeded field counts as filled and is not parsed again. When the
 * draft also carries a value for that key the draft wins, unless the id is in
 * `lockedFields`, in which case the seed always wins.
 */
export function validateDraft(
  fields: Record<string, NewRowFieldConfig>,
  draft: DraftValues,
  initialValues: CoercedDraft = {},
  lockedFields: readonly string[] = []
): ValidationResult {
  const value: CoercedDraft = {};
  const errors: DraftFieldError[] = [];
  const locked = new Set(lockedFields);

  for (const [id, config] of Object.entries(fields)) {
    const seeded = initialValues[id];
    const raw = draft[id] ?? "";
    if (seeded !== undefined && (locked.has(id) || raw === "")) {
      value[id] = seeded;
      continue;
    }
    const result = fieldKind(config.type).parse(raw, config);
    if (result.ok) value[id] = result.value;
    else errors.push({ field: id, error: result.error });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
