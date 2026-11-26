import { fieldKind } from "@/fields";
import type { ActionError, Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { set } from "react-hook-form";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";

import type { FieldSpec } from "@/components/forms/components/EntityForm";

type FlatFieldSpec<T extends FieldValues> = Exclude<
  FieldSpec<T>,
  { kind: "pair" }
>;

function flatten<T extends FieldValues>(
  fields: FieldSpec<T>[]
): FlatFieldSpec<T>[] {
  return fields.flatMap((field): FlatFieldSpec<T> | FlatFieldSpec<T>[] =>
    field.kind === "pair" ? flatten(field.fields) : field
  );
}

/**
 * An action-fetched statuses result down to the list a kind's `parse` and
 * `config.statuses` want: an `ActionError` becomes an empty list, the same
 * unwrap `FieldKindInput` does after its own `use(statuses)`.
 */
export function unwrapStatuses(result: Status[] | ActionError): Status[] {
  return isActionError(result) ? [] : result;
}

/**
 * A react-hook-form resolver built straight from a form's field specs,
 * rather than a hand-written zod schema kept in sync with them by hand. A
 * `field-kind` spec and the title input (`type: "title"`, parsed with the
 * `text` kind) run their raw string through their kind's own `parse`, the
 * same one `validateDraft` uses for a table's draft row, with `required`
 * folded into its config so a kind that already rejects a blank on its own
 * does not produce two different messages. Every other spec's raw value
 * passes through unparsed: it is validated some other way, or not at all. A
 * `custom` spec's optional `validate` runs against its own raw value, nested
 * into `errors` by path so react-hook-form can find a field array's own
 * errors. Async so a `field: "status"` spec's `statuses` promise can be
 * awaited before its `parse` runs — by submit time `FieldKindInput` has
 * already resolved the same promise via `use`, so the await here never
 * actually waits.
 */
export function fieldKindResolver<
  TRaw extends FieldValues,
  TOut extends FieldValues,
>(fields: FieldSpec<TRaw>[]): Resolver<TRaw, unknown, TOut> {
  return async (values) => {
    const parsed: Record<string, unknown> = {};
    const errors: Record<string, unknown> = {};

    for (const spec of flatten(fields)) {
      if (spec.kind === "custom") {
        parsed[spec.key] = values[spec.key];
        if (!spec.validate) continue;
        for (const [path, message] of Object.entries(
          spec.validate(values[spec.key])
        )) {
          set(errors, path, { type: "validate", message });
        }
        continue;
      }
      const name = spec.name as string;
      const raw = typeof values[name] === "string" ? values[name] : "";

      if (spec.kind === "field-kind") {
        const statuses = spec.statuses
          ? unwrapStatuses(await spec.statuses)
          : spec.config?.statuses;
        const result = fieldKind(spec.field).parse(raw, {
          ...spec.config,
          statuses,
          required: spec.required,
        });
        if (result.ok) parsed[name] = result.value;
        else errors[name] = { type: "validate", message: result.error };
        continue;
      }

      if (
        (spec.kind === undefined || spec.kind === "field") &&
        spec.type === "title"
      ) {
        // Every entity's title or name is required, as the server insists.
        const result = fieldKind("text").parse(raw, { required: true });
        if (result.ok) parsed[name] = result.value;
        else errors[name] = { type: "validate", message: result.error };
        continue;
      }

      parsed[name] = values[name];
    }

    if (Object.keys(errors).length > 0) {
      return { values: {}, errors: errors as FieldErrors<TRaw> };
    }
    return { values: parsed as TOut, errors: {} };
  };
}
