"use client";

import { createSession } from "@/actions/sessions";
import {
  EntityForm,
  type FieldSpec,
  useEntityForm,
} from "@/components/forms/components/EntityForm";
import { dawSuggestions } from "@/entities/session/daw-suggestions";
import { richTextDocument } from "@/lib/rich-text";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { SessionDaw } from "@workspace/api/api";

type SessionFormDraft = {
  name: string;
  notes: string;
  dawName: string;
};

type SessionFormValues = {
  name: string;
  notes: string;
  dawName: string | null;
};

/**
 * A form-created session has no dit repo behind it, so it is always tagged
 * `daw: "manual"`; `dawName` is whatever the person typed, offered back the
 * project's own DAWs as suggestions rather than a fixed list.
 */
export const SessionForm = ({
  projectId,
  collectionId,
  trackId,
  initialName,
  daws = [],
}: {
  projectId: number;
  collectionId?: number;
  trackId?: number;
  initialName?: string;
  daws?: SessionDaw[];
}) => {
  const fields: FieldSpec<SessionFormDraft>[] = [
    {
      name: "name",
      label: "Title",
      type: "title",
      placeholder: "ydkyb FINAL FINAL",
    },
    {
      name: "notes",
      label: "Notes",
      type: "blocknote",
      blocknotePlaceholder: "Session notes...",
    },
    {
      kind: "field-kind",
      name: "dawName",
      field: "suggest",
      label: "DAW",
      config: {
        placeholder: "e.g. Cubase, FL Studio",
        suggestions: dawSuggestions(daws),
      },
    },
  ];

  const { form, onSubmit } = useEntityForm({
    fields,
    defaultValues: { name: initialName ?? "", notes: "", dawName: "" },
    submit: (data: SessionFormValues) =>
      createSession({
        ...data,
        daw: "manual",
        notes: richTextDocument(data.notes),
        projectId,
        trackId,
      }),
    created: (session) => `Created session ${session.name}`,
    createdHref: (session) =>
      hrefFromParsedRoute(
        {
          kind: "session",
          sessionId: session.id,
          collectionId,
          trackId: session.trackId || undefined,
        },
        projectId
      ),
  });

  return (
    <EntityForm
      id="new-session-form"
      form={form}
      onSubmit={onSubmit}
      fields={fields}
      submitLabel="Create session"
      busyLabel="Creating…"
    />
  );
};
