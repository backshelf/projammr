"use client";

import { createStatus, updateStatus } from "@/actions/statuses";
import { ColourInput } from "@/components/settings/ColourInput";
import { InlineForm } from "@/components/settings/InlineForm";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const statusSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  colourHex: z.string().optional(),
  percentage: z
    .number("Completion is a number from 0 to 100")
    .min(0, "Completion is a number from 0 to 100")
    .max(100, "Completion is a number from 0 to 100")
    .optional(),
});

type StatusFormData = z.infer<typeof statusSchema>;

type SettingsStatusFormProps = {
  projectId: number;
  mode: "create" | "edit";
  status?: Status;
  onDone: () => void;
};

/** The one-line form that adds a status or edits one. */
export default function SettingsStatusForm({
  projectId,
  mode,
  status,
  onDone,
}: SettingsStatusFormProps) {
  const id = useId();
  const form = useForm<StatusFormData>({
    resolver: zodResolver(statusSchema),
    defaultValues: {
      name: status?.name ?? "",
      description: status?.description ?? "",
      colourHex: status?.colourHex ?? "",
      percentage: status?.percentage || 0,
    },
  });

  const onSubmit = async (data: StatusFormData) => {
    if (mode === "create") {
      const result = await createStatus({ ...data, projectId });
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Status created");
    } else if (status) {
      const result = await updateStatus(status.id, data);
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Status updated");
    }
    onDone();
  };

  const { errors, isSubmitting } = form.formState;
  const invalid = (field: keyof StatusFormData) => errors[field] != null;

  return (
    <InlineForm
      label={mode === "create" ? "Add status" : `Edit ${status?.name}`}
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={onDone}
      submitting={isSubmitting}
      error={Object.values(errors)[0]?.message}
    >
      <Input
        {...form.register("name")}
        id={`${id}-name`}
        aria-label="Name"
        aria-invalid={invalid("name")}
        placeholder="Name"
        autoFocus
        className="w-44 flex-1"
      />
      <Input
        {...form.register("description")}
        id={`${id}-description`}
        aria-label="Description"
        placeholder="Description (optional)"
        className="w-56 flex-[2]"
      />
      <Controller
        control={form.control}
        name="colourHex"
        render={({ field }) => <ColourInput {...field} id={`${id}-colour`} />}
      />
      <Input
        {...form.register("percentage", {
          setValueAs: (value) => (value === "" ? 0 : Number(value)),
        })}
        id={`${id}-percentage`}
        type="number"
        min={0}
        max={100}
        aria-label="Completion, 0 to 100"
        aria-invalid={invalid("percentage")}
        placeholder="Completion %"
        className="w-28 flex-none"
      />
    </InlineForm>
  );
}
