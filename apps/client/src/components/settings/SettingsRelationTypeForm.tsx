"use client";

import {
  createRelationType,
  renameRelationType,
} from "@/actions/relation-types";
import { InlineForm } from "@/components/settings/InlineForm";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RelationTypeEntry } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Input } from "@workspace/ui/components/input";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const relationTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

type RelationTypeFormData = z.infer<typeof relationTypeSchema>;

type SettingsRelationTypeFormProps = {
  projectId: number;
  mode: "create" | "edit";
  type?: RelationTypeEntry;
  onDone: () => void;
};

/** The one-line form that adds a relation type or renames one. */
export default function SettingsRelationTypeForm({
  projectId,
  mode,
  type,
  onDone,
}: SettingsRelationTypeFormProps) {
  const id = useId();
  const form = useForm<RelationTypeFormData>({
    resolver: zodResolver(relationTypeSchema),
    defaultValues: { name: type?.name ?? "" },
  });

  const onSubmit = async ({ name }: RelationTypeFormData) => {
    if (mode === "create") {
      const result = await createRelationType(projectId, name);
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Relation type created");
    } else if (type) {
      const result = await renameRelationType(projectId, type.id, name);
      if (isActionError(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Relation type renamed");
    }
    onDone();
  };

  const { errors, isSubmitting } = form.formState;

  return (
    <InlineForm
      label={mode === "create" ? "Add relation type" : `Edit ${type?.name}`}
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={onDone}
      submitting={isSubmitting}
      error={errors.name?.message}
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
    </InlineForm>
  );
}
