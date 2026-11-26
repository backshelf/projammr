"use client";

import type { CustomFieldFormData } from "@/components/settings/CustomFieldForm";
import { ColourInput } from "@/components/settings/ColourInput";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import {
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { Input } from "@workspace/ui/components/input";
import { useId } from "react";
import { Controller, useFieldArray, type Control } from "react-hook-form";

/** A select field's option form has no colour to inherit from, so a new row
 *  starts on the same black the standalone colour picker defaults to. */
// eslint-disable-next-line no-restricted-syntax -- an option's colour is a hex value the server stores, not a theme colour
export const DEFAULT_OPTION_COLOUR = "#101010";

/**
 * The rows of a select field's options, inside `CustomFieldForm`: a label and
 * a colour per row, add, remove, and up/down reorder (no drag — the field
 * form is a one-line shell, not a sortable surface). Removing a saved option
 * that rows hold asks first, saying how many, since they keep the id until
 * edited; a new or unused option just goes.
 */
export function FieldOptionsEditor({
  control,
  optionCounts,
}: {
  control: Control<CustomFieldFormData>;
  /** Rows holding each saved option, by option id; an option absent holds none. */
  optionCounts: Record<string, number>;
}) {
  // `keyName` moves react-hook-form's own per-row id off "id": the schema's
  // own `id` is the option's server id and must survive untouched.
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "options",
    keyName: "fieldKey",
  });
  // Holds the count with the index: `remove` shifts `fields` while the
  // confirm is still closing, so the index alone would name the next option.
  const removal = useDeleteGate<{ index: number; count: number }>(
    "fieldOption",
    ({ index }) => remove(index)
  );
  const id = useId();
  const confirmingCount = removal.pending?.count ?? 0;

  const askOrRemove = (index: number) => {
    const option = fields[index];
    const count = option?.id ? (optionCounts[option.id] ?? 0) : 0;
    if (count > 0) {
      removal.request({ index, count });
    } else {
      remove(index);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-paper p-1.5">
      {fields.map((option, index) => (
        <div key={option.fieldKey} className="flex items-center gap-1.5">
          <Controller
            control={control}
            name={`options.${index}.label`}
            render={({ field }) => (
              <Input
                {...field}
                aria-label={`Option ${index + 1} label`}
                placeholder="Label"
                className="w-32 flex-1"
              />
            )}
          />
          <Controller
            control={control}
            name={`options.${index}.colour`}
            render={({ field }) => (
              <ColourInput
                {...field}
                value={field.value ?? ""}
                id={`${id}-colour-${index}`}
              />
            )}
          />
          <button
            type="button"
            aria-label={`Move option ${index + 1} up`}
            disabled={index === 0}
            onClick={() => move(index, index - 1)}
            className="text-ink-soft hover:text-ink disabled:opacity-30"
          >
            <IconChevronUp size={14} />
          </button>
          <button
            type="button"
            aria-label={`Move option ${index + 1} down`}
            disabled={index === fields.length - 1}
            onClick={() => move(index, index + 1)}
            className="text-ink-soft hover:text-ink disabled:opacity-30"
          >
            <IconChevronDown size={14} />
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove option ${index + 1}`}
            onClick={() => askOrRemove(index)}
          >
            <IconTrash size={14} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-ink-soft"
        onClick={() => append({ label: "", colour: DEFAULT_OPTION_COLOUR })}
      >
        <IconPlus size={14} />
        Add option
      </Button>
      <ConfirmDeleteDialog
        {...removal.dialog}
        title="Remove this option?"
        description={
          confirmingCount === 1
            ? "1 row holds this option and will show its id until edited."
            : `${confirmingCount} rows hold this option and will show its id until edited.`
        }
        confirmLabel="Remove option"
      />
    </div>
  );
}
