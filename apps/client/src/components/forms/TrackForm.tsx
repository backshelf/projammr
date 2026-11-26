"use client";

import { createTrack } from "@/actions/tracks";
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
import { useSetting } from "@/lib/settings/provider";
import { richTextDocument } from "@/lib/rich-text";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { ActionError, CustomField, Status } from "@workspace/api/api";

type TrackFormDraft = {
  title: string;
  notes: string;
  artists: string;
  trackPosition: string;
  isrc: string;
  iswc: string;
  statusId: string;
  explicit: string;
} & CustomFieldDrafts;

type TrackFormValues = {
  title: string;
  notes: string;
  artists: string[];
  trackPosition: number | null;
  isrc: string | null;
  iswc: string | null;
  statusId: number | null;
  explicit: boolean;
};

export const TrackForm = ({
  projectId,
  collectionId,
  statusesProm,
  initialTitle,
  customFields = [],
  onStay,
}: {
  projectId: number;
  collectionId?: number;
  statusesProm: Promise<Status[] | ActionError>;
  initialTitle?: string;
  /** The project's track fields, each an optional row after the built-in ones. */
  customFields?: readonly CustomField[];
  /** Closes the dialog the form sits in, when it sits in one. */
  onStay?: () => void;
}) => {
  const defaultStatusId = useDefaultStatusRaw(
    "project-defaults.trackStatusId",
    statusesProm
  );
  const defaultArtists = useSetting("project-defaults.artists");
  const defaultExplicit = useSetting("project-defaults.explicit");

  const fields: FieldSpec<TrackFormDraft>[] = [
    {
      name: "title",
      label: "Title",
      type: "title",
      placeholder: "You Don't Know You're Beautiful",
    },
    {
      kind: "field-kind",
      name: "artists",
      field: "list",
      label: "Artists",
      hint: "Separate artist names by commas",
      config: { placeholder: "Comma-separated names" },
    },
    {
      name: "notes",
      label: "Notes",
      type: "blocknote",
      blocknotePlaceholder: "Your notes here...",
    },
    {
      kind: "pair",
      fields: [
        {
          kind: "field-kind",
          name: "trackPosition",
          field: "number",
          label: "Track position",
          config: { placeholder: "#" },
        },
        {
          kind: "field-kind",
          name: "statusId",
          field: "status",
          label: "Status",
          hint: "Where this track sits in your pipeline",
          required: true,
          statuses: statusesProm,
        },
      ],
    },
    {
      kind: "pair",
      fields: [
        {
          kind: "field-kind",
          name: "isrc",
          field: "text",
          label: "ISRC",
          config: { placeholder: "USXX12300000" },
        },
        {
          kind: "field-kind",
          name: "iswc",
          field: "text",
          label: "ISWC",
          config: { placeholder: "T-00000000000" },
        },
      ],
    },
    {
      kind: "field-kind",
      name: "explicit",
      field: "checkbox",
      label: "Explicit",
    },
    ...customFieldSpecs<TrackFormDraft>(customFields),
  ];

  const defaultValues: TrackFormDraft = {
    title: initialTitle ?? "",
    notes: "",
    artists: defaultArtists.join(", "),
    trackPosition: "",
    isrc: "",
    iswc: "",
    statusId: defaultStatusId,
    explicit: String(defaultExplicit),
    ...customFieldDefaults(customFields),
  };

  const { form, onSubmit } = useEntityForm({
    fields,
    defaultValues,
    submit: (data: TrackFormValues) =>
      createTrack({
        ...bagCustomFields(data),
        notes: richTextDocument(data.notes),
        trackPosition: data.trackPosition ?? undefined,
        statusId: data.statusId ?? undefined,
        projectId,
        collectionId,
      }),
    created: (track) => `Created track ${track.title}`,
    createdHref: (track) =>
      hrefFromParsedRoute(
        { kind: "track", trackId: track.id, collectionId },
        projectId
      ),
    onStay,
  });

  return (
    <EntityForm
      id="new-track-form"
      form={form}
      onSubmit={onSubmit}
      fields={fields}
      submitLabel="Create track"
      busyLabel="Creating…"
    />
  );
};
