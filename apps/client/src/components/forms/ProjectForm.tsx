"use client";

import { createProject } from "@/actions/projects";
import {
  EntityForm,
  type FieldSpec,
  useEntityForm,
} from "@/components/forms/components/EntityForm";
import { FormPair } from "@/components/forms/components/FormLayout";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { FormController } from "@workspace/ui/components/forms/form-controller";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { richTextDocument } from "@/lib/rich-text";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

type ProjectLink = { name: string; url: string };

type ProjectFormDraft = {
  name: string;
  description: string;
  links: ProjectLink[];
};

type ProjectFormValues = {
  name: string;
  description: string;
  links: ProjectLink[];
};

/** The repeatable name + URL pairs, with add and remove. */
function LinksField({ form }: { form: UseFormReturn<ProjectFormDraft> }) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "links",
  });

  return (
    <FieldSet>
      <FieldLegend variant="label">Links</FieldLegend>
      <FieldDescription>
        Social media, a website, a streaming page — anywhere this project lives.
      </FieldDescription>
      <FieldGroup>
        {fields.map((field, index) => (
          <FormPair key={field.id}>
            <FormController
              control={form.control}
              name={`links.${index}.name`}
              label="Name"
              placeholder="Website"
            />
            <FormController
              control={form.control}
              name={`links.${index}.url`}
              label="URL"
              placeholder="https://mywebsite.com"
              inputType="url"
              trailing={
                <InputGroupButton
                  onClick={() => remove(index)}
                  className="mr-1 rounded-md"
                  variant="ghost"
                  aria-label={`Remove link ${index + 1}`}
                >
                  <IconMinus />
                </InputGroupButton>
              }
            />
          </FormPair>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-ink-soft"
          onClick={() => append({ name: "", url: "" })}
        >
          <IconPlus />
          Add link
        </Button>
      </FieldGroup>
    </FieldSet>
  );
}

/** A blank name gets "Name this link"; a URL that fails `z.url()` gets
 *  "Enter a valid URL, including https://" — react-hook-form ignores
 *  field-level `rules` once a resolver is set, so the links validate here. */
function validateLinks(value: unknown): Record<string, string> {
  const links = value as ProjectLink[];
  const errors: Record<string, string> = {};
  links.forEach((link, index) => {
    if (!link.name.trim()) errors[`links.${index}.name`] = "Name this link";
    if (!z.url().safeParse(link.url).success) {
      errors[`links.${index}.url`] = "Enter a valid URL, including https://";
    }
  });
  return errors;
}

export const ProjectForm = () => {
  const fields: FieldSpec<ProjectFormDraft>[] = [
    {
      name: "name",
      label: "Name (required)",
      type: "title",
      placeholder: "Name your project",
    },
    {
      name: "description",
      label: "Description",
      type: "blocknote",
      blocknotePlaceholder: "Describe your project...",
      className: "min-h-24",
    },
    {
      kind: "custom",
      key: "links",
      render: (f) => <LinksField form={f} />,
      validate: validateLinks,
    },
  ];

  const { form, onSubmit } = useEntityForm({
    fields,
    defaultValues: { name: "", description: "", links: [] },
    submit: (data: ProjectFormValues) =>
      createProject({
        ...data,
        description: richTextDocument(data.description),
      }),
    created: (project) => `Created project ${project.name}`,
    createdHref: (project) =>
      hrefFromParsedRoute({ kind: "project" }, project.id),
  });

  return (
    <EntityForm
      id="new-project-form"
      form={form}
      onSubmit={onSubmit}
      fields={fields}
      submitLabel="Create project"
      busyLabel="Creating…"
    />
  );
};
