"use client";

import { createCustomField, updateCustomField } from "@/actions/custom-fields";
import { optionalHexColourSchema } from "@/components/settings/ColourInput";
import { FieldOptionsEditor } from "@/components/settings/FieldOptionsEditor";
import { InlineForm } from "@/components/settings/InlineForm";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  CustomField,
  CustomFieldKind,
  CustomFieldType,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useId } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

/** The type badge's label for each `CustomFieldType`; nothing else reuses this map. */
export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  select: "Select",
  url: "URL",
};

const FIELD_TYPES = Object.entries(FIELD_TYPE_LABELS) as [
  CustomFieldType,
  string,
][];

// An option's colour is optional on the server (one made through the API or
// MCP may have none), so an empty one is valid and is not sent.
const optionSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Every option needs a label"),
  colour: optionalHexColourSchema.optional(),
});

const fieldSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  type: z.enum(["text", "number", "date", "checkbox", "select", "url"]),
  options: z.array(optionSchema),
});

export type CustomFieldFormData = z.infer<typeof fieldSchema>;

const resolveFieldSchema = zodResolver(fieldSchema);

/** Only a select's options are validated (and submitted): rows added under
 *  Select before the type changed are off screen and must not block Save. */
const resolver: Resolver<CustomFieldFormData> = (values, context, options) =>
  resolveFieldSchema(
    values.type === "select" ? values : { ...values, options: [] },
    context,
    options
  );

/** The one-line form that adds a field or edits one: name, and on create only
 *  a type; a select field's options editor opens beneath it. The type is
 *  fixed once a field exists, so an edit shows it as plain text and says why. */
export default function CustomFieldForm({
  projectId,
  kind,
  mode,
  field,
  onDone,
}: {
  projectId: number;
  kind: CustomFieldKind;
  mode: "create" | "edit";
  field?: CustomField;
  onDone: () => void;
}) {
  const id = useId();
  const form = useForm<CustomFieldFormData>({
    resolver,
    defaultValues: {
      name: field?.name ?? "",
      type: field?.type ?? "text",
      options: field?.options ?? [],
    },
  });
  const type = form.watch("type");
  const { errors, isSubmitting, dirtyFields } = form.formState;

  const onSubmit = async ({
    name,
    type: chosenType,
    options,
  }: CustomFieldFormData) => {
    // `options` replaces the field's whole list on the server, so an edit
    // sends it only when it changed here; a rename alone must not overwrite
    // options another editor added since this form opened.
    const sendOptions =
      chosenType === "select" &&
      (mode === "create" || dirtyFields.options !== undefined);
    const optionsData = sendOptions
      ? options.map((option) => ({
          ...(option.id ? { id: option.id } : {}),
          label: option.label,
          ...(option.colour ? { colour: option.colour } : {}),
        }))
      : undefined;

    if (mode === "create") {
      const result = await createCustomField(projectId, {
        kind,
        name,
        type: chosenType,
        ...(optionsData ? { options: optionsData } : {}),
      });
      if (isActionError(result)) {
        form.setError("name", { type: "server", message: result.error });
        return;
      }
    } else if (field) {
      const result = await updateCustomField(projectId, field.id, {
        name,
        ...(optionsData ? { options: optionsData } : {}),
      });
      if (isActionError(result)) {
        form.setError("name", { type: "server", message: result.error });
        return;
      }
    }
    onDone();
  };

  const firstError =
    errors.name?.message ??
    errors.type?.message ??
    errors.options?.find?.((option) => option)?.label?.message ??
    errors.options?.find?.((option) => option)?.colour?.message;

  return (
    <InlineForm
      label={mode === "create" ? "Add field" : `Edit ${field?.name}`}
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={onDone}
      submitting={isSubmitting}
      error={firstError}
    >
      <Input
        {...form.register("name")}
        id={`${id}-name`}
        aria-label="Name"
        aria-invalid={errors.name != null}
        placeholder="Name"
        autoFocus
        className="w-44 flex-1"
      />
      {mode === "create" ? (
        <Controller
          control={form.control}
          name="type"
          render={({ field: typeField }) => (
            <Select
              value={typeField.value}
              items={FIELD_TYPES.map(([value, label]) => ({ value, label }))}
              onValueChange={typeField.onChange}
            >
              <SelectTrigger aria-label="Type" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      ) : (
        <>
          <span
            aria-label="Type"
            className="rounded-md bg-paper-sunk px-2 py-1 text-micro text-ink-soft"
          >
            {FIELD_TYPE_LABELS[field!.type]}
          </span>
          <span className="basis-full text-micro text-ink-soft">
            A field's type can't change once it exists.
          </span>
        </>
      )}
      {type === "select" && (
        <div className="basis-full">
          <FieldOptionsEditor
            control={form.control}
            optionCounts={field?.optionCounts ?? {}}
          />
        </div>
      )}
    </InlineForm>
  );
}
