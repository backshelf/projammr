"use client";

import { createCollection } from "@/actions/collections";
import {
  EntityForm,
  type FieldSpec,
  useEntityForm,
} from "@/components/forms/components/EntityForm";
import {
  customFieldDefaults,
  type CustomFieldDrafts,
  customFieldSpecs,
} from "@/components/forms/components/custom-field-specs";
import { useDefaultStatusRaw } from "@/components/forms/components/default-status";
import { bagCustomFields } from "@/fields/custom-field";
import { richTextDocument } from "@/lib/rich-text";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { ActionError, CustomField, Status } from "@workspace/api/api";

type CollectionFormDraft = {
  title: string;
  notes: string;
  statusId: string;
  releaseDate: string;
  upc: string;
} & CustomFieldDrafts;

type CollectionFormValues = {
  title: string;
  notes: string;
  statusId: number | null;
  releaseDate: string | null;
  upc: string | null;
};

export const CollectionForm = ({
  projectId,
  statusesProm,
  customFields = [],
}: {
  projectId: number;
  statusesProm: Promise<Status[] | ActionError>;
  /** The project's collection fields, each an optional row after the built-in ones. */
  customFields?: readonly CustomField[];
}) => {
  const defaultStatusId = useDefaultStatusRaw(
    "project-defaults.collectionStatusId",
    statusesProm
  );

  const fields: FieldSpec<CollectionFormDraft>[] = [
    {
      name: "title",
      label: "Title",
      type: "title",
      placeholder: "Up All Night",
    },
    {
      name: "notes",
      label: "Notes",
      type: "blocknote",
      blocknotePlaceholder: "Your notes here...",
    },
    {
      kind: "field-kind",
      name: "statusId",
      field: "status",
      label: "Status",
      hint: "Where this collection sits in your pipeline",
      statuses: statusesProm,
    },
    {
      kind: "pair",
      fields: [
        {
          kind: "field-kind",
          name: "releaseDate",
          field: "date",
          label: "Release date",
        },
        {
          kind: "field-kind",
          name: "upc",
          field: "text",
          label: "UPC",
          config: { placeholder: "UPC" },
        },
      ],
    },
    ...customFieldSpecs<CollectionFormDraft>(customFields),
  ];

  const defaultValues: CollectionFormDraft = {
    title: "",
    notes: "",
    statusId: defaultStatusId,
    releaseDate: "",
    upc: "",
    ...customFieldDefaults(customFields),
  };

  const { form, onSubmit } = useEntityForm({
    fields,
    defaultValues,
    submit: (data: CollectionFormValues) =>
      createCollection({
        ...bagCustomFields(data),
        notes: richTextDocument(data.notes),
        projectId,
      }),
    created: (collection) => `Created collection ${collection.title}`,
    createdHref: (collection) =>
      hrefFromParsedRoute(
        { kind: "collection", collectionId: collection.id },
        projectId
      ),
  });

  return (
    <EntityForm
      id="new-collection-form"
      form={form}
      onSubmit={onSubmit}
      fields={fields}
      submitLabel="Create collection"
      busyLabel="Creating…"
    />
  );
};
