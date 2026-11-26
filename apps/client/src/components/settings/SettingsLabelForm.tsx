"use client";

import { createLabel, updateLabel } from "@/actions/labels";
import {
  ColourInput,
  optionalHexColourSchema,
} from "@/components/settings/ColourInput";
import { InlineForm } from "@/components/settings/InlineForm";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Label } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  colourHex: optionalHexColourSchema,
});

type LabelFormData = z.infer<typeof labelSchema>;

type SettingsLabelFormProps = {
  projectId: number;
  mode: "create" | "edit";
  label?: Label;
  onDone: () => void;
};

/** The one-line form that adds a label or edits one. */
export default function SettingsLabelForm({
  projectId,
  mode,
  label,
  onDone,
}: SettingsLabelFormProps) {
  const id = useId();
  const form = useForm<LabelFormData>({
    resolver: zodResolver(labelSchema),
    defaultValues: {
      name: label?.name ?? "",
      colourHex: label?.colourHex ?? "",
    },
  });

  const onSubmit = async ({ name, colourHex }: LabelFormData) => {
    const data = { name, ...(colourHex ? { colourHex } : {}) };
    if (mode === "create") {
      const result = await createLabel(projectId, data);
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Label created");
    } else if (label) {
      const result = await updateLabel(projectId, label.id, data);
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Label updated");
    }
    onDone();
  };

  const { errors, isSubmitting } = form.formState;

  return (
    <InlineForm
      label={mode === "create" ? "Add label" : `Edit ${label?.name}`}
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={onDone}
      submitting={isSubmitting}
      error={Object.values(errors)[0]?.message}
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
      <Controller
        control={form.control}
        name="colourHex"
        render={({ field }) => <ColourInput {...field} id={`${id}-colour`} />}
      />
    </InlineForm>
  );
}
