"use client";

import { createPriorityLevel, updatePriorityLevel } from "@/actions/priorities";
import { ColourInput, colourHexField } from "@/components/settings/ColourInput";
import { InlineForm } from "@/components/settings/InlineForm";
import { zodResolver } from "@hookform/resolvers/zod";
import type { PriorityScaleLevel } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const levelSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  colour: colourHexField,
});

type LevelFormData = z.infer<typeof levelSchema>;

type PriorityLevelFormProps = {
  projectId: number;
  onDone: () => void;
} & (
  | {
      mode: "create";
      /** The colour a new level starts from. */
      colour: string;
    }
  | { mode: "edit"; level: PriorityScaleLevel }
);

/**
 * The one-line form that adds a priority level or edits one: its name and its
 * colour. An edit sends only what changed, and saving an unchanged level just
 * closes the form. A write the server refuses keeps the form open with the
 * reason in the row; a name the scale already has marks the name field.
 */
export function PriorityLevelForm(props: PriorityLevelFormProps) {
  const { projectId, onDone } = props;
  const level = props.mode === "edit" ? props.level : undefined;
  const id = useId();
  const form = useForm<LevelFormData>({
    resolver: zodResolver(levelSchema),
    defaultValues: {
      name: level?.name ?? "",
      colour: level?.colour ?? (props.mode === "create" ? props.colour : ""),
    },
  });

  const save = async ({ name, colour }: LevelFormData) => {
    if (!level) return createPriorityLevel(projectId, { name, colour });
    const changes = {
      ...(name !== level.name ? { name } : {}),
      ...(colour !== level.colour ? { colour } : {}),
    };
    if (Object.keys(changes).length === 0) return null;
    return updatePriorityLevel(projectId, level.id, changes);
  };

  const onSubmit = async (data: LevelFormData) => {
    const result = await save(data);
    if (result && isActionError(result)) {
      form.setError(result.status === 409 ? "name" : "root", {
        message: result.error,
      });
      return;
    }
    if (result) {
      toast.success(level ? "Priority level updated" : "Priority level added");
    }
    onDone();
  };

  const { errors, isSubmitting } = form.formState;

  return (
    <InlineForm
      label={level ? `Edit ${level.name}` : "Add priority level"}
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
        name="colour"
        render={({ field }) => <ColourInput {...field} id={`${id}-colour`} />}
      />
    </InlineForm>
  );
}
