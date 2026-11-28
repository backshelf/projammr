import type { ActionError, Status } from "@workspace/api/api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { AfterCreate } from "@/lib/policies/shell";
import type { DefaultValues, FieldValues } from "react-hook-form";

import type { FieldSpec } from "./EntityForm";

const back = mock();
const push = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toastSuccess = mock<(message: string, options?: ToastOptions) => void>();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const { EntityForm, useEntityForm } = await import("./EntityForm");

afterEach(() => {
  cleanup();
  back.mockClear();
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

const okResult = { ok: true } as const;

function Harness<TRaw extends FieldValues, TOut extends FieldValues>({
  fields,
  defaultValues,
  submit,
  onStay,
  onCancel,
}: {
  fields: FieldSpec<TRaw>[];
  defaultValues: DefaultValues<TRaw>;
  submit: (data: TOut) => Promise<typeof okResult | ActionError>;
  onStay?: () => void;
  onCancel?: () => void;
}) {
  const { form, onSubmit } = useEntityForm({
    fields,
    defaultValues,
    submit,
    created: () => "Created",
    createdHref: () => "/created",
    onStay,
  });

  return (
    <EntityForm
      id="test-form"
      form={form}
      onSubmit={onSubmit}
      fields={fields}
      submitLabel="Create"
      busyLabel="Creating…"
      onCancel={onCancel}
    />
  );
}

type Draft = { title: string; bpm: string };
type Parsed = { title: string; bpm: number | null };

const draftFields: FieldSpec<Draft>[] = [
  {
    kind: "field-kind",
    name: "title",
    field: "text",
    label: "Title",
    required: true,
  },
  {
    kind: "field-kind",
    name: "bpm",
    field: "number",
    label: "BPM",
    hint: "Beats per minute",
  },
];

const renderDraftForm = (
  submit: (data: Parsed) => Promise<typeof okResult | ActionError>
) =>
  render(
    <Harness<Draft, Parsed>
      fields={draftFields}
      defaultValues={{ title: "", bpm: "" }}
      submit={submit}
    />
  );

const create = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  });

describe("EntityForm field-kind rows", () => {
  it("shows the kind's parse error and blocks submit", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Song" },
    });
    fireEvent.change(screen.getByLabelText("BPM"), {
      target: { value: "abc" },
    });
    await create();

    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows the kind's parse error on blur, before any submit", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    const bpm = screen.getByLabelText("BPM");
    fireEvent.change(bpm, { target: { value: "abc" } });
    await act(async () => {
      fireEvent.blur(bpm);
    });

    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
    expect(submit).not.toHaveBeenCalled();
  });

  it("moves focus to the invalid field-kind row after a failed submit", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Song" },
    });
    fireEvent.change(screen.getByLabelText("BPM"), {
      target: { value: "abc" },
    });
    await create();

    expect(document.activeElement).toBe(screen.getByLabelText("BPM"));
  });

  it("says Required for an empty required field", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    await create();

    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits values parsed to their kind's type, not the raw strings", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  Song  " },
    });
    fireEvent.change(screen.getByLabelText("BPM"), {
      target: { value: "120" },
    });
    await create();

    expect(submit).toHaveBeenCalledWith({ title: "Song", bpm: 120 });
  });

  it("parses a blank, non-required field to null rather than empty string", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Song" },
    });
    await create();

    expect(submit).toHaveBeenCalledWith({ title: "Song", bpm: null });
  });

  it("associates the label with the input via htmlFor/id", () => {
    renderDraftForm(mock(async () => okResult));

    const input = screen.getByLabelText("Title");
    const label = screen.getByText("Title");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("puts the hint, and once invalid the error, in aria-describedby", async () => {
    const submit = mock(async () => okResult);
    renderDraftForm(submit);

    const bpm = screen.getByLabelText("BPM");
    expect(bpm.getAttribute("aria-describedby")).toBe("bpm-description");

    fireEvent.change(bpm, { target: { value: "abc" } });
    await create();

    expect(bpm.getAttribute("aria-describedby")).toBe(
      "bpm-description bpm-error"
    );
  });

  it("suspends only the field with a pending statuses promise, not the form", () => {
    const statuses = new Promise<Status[]>(() => {});
    type StatusDraft = { title: string; statusId: string };
    const fields: FieldSpec<StatusDraft>[] = [
      { kind: "field-kind", name: "title", field: "text", label: "Title" },
      {
        kind: "field-kind",
        name: "statusId",
        field: "status",
        label: "Status",
        statuses,
      },
    ];

    render(
      <Harness<StatusDraft, StatusDraft>
        fields={fields}
        defaultValues={{ title: "", statusId: "" }}
        submit={async () => okResult}
      />
    );

    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.queryByText(/none/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("finds the status picker by its label and reads its error description", async () => {
    type StatusDraft = { statusId: string };
    const fields: FieldSpec<StatusDraft>[] = [
      {
        kind: "field-kind",
        name: "statusId",
        field: "status",
        label: "Status",
        required: true,
      },
    ];

    render(
      <Harness<StatusDraft, StatusDraft>
        fields={fields}
        defaultValues={{ statusId: "" }}
        submit={async () => okResult}
      />
    );

    const trigger = screen.getByLabelText("Status");
    await create();

    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(trigger.getAttribute("aria-describedby")).toBe("statusId-error");
  });
});

describe("EntityForm after a record is created", () => {
  const createSong = async (afterCreate?: AfterCreate, onStay?: () => void) => {
    const policies = afterCreate
      ? {
          ...DEFAULT_POLICIES,
          shell: { ...DEFAULT_POLICIES.shell, afterCreate },
        }
      : DEFAULT_POLICIES;
    render(
      <PoliciesProvider policies={policies}>
        <Harness<Draft, Parsed>
          fields={draftFields}
          defaultValues={{ title: "", bpm: "" }}
          submit={async () => okResult}
          onStay={onStay}
        />
      </PoliciesProvider>
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Song" },
    });
    fireEvent.change(screen.getByLabelText("BPM"), {
      target: { value: "120" },
    });
    await create();
  };

  const toastLink = () => toastSuccess.mock.calls[0]?.[1]?.action;

  it("opens the created record's page by default", async () => {
    await createSong();

    expect(toastSuccess).toHaveBeenCalledWith("Created");
    expect(toastLink()).toBeUndefined();
    expect(push).toHaveBeenCalledWith("/created");
    expect(back).not.toHaveBeenCalled();
  });

  it("goes back to where the form was opened from, the toast linking to the record", async () => {
    await createSong("stay");

    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(toastLink()?.label).toBe("Open");

    toastLink()?.onClick();
    expect(push).toHaveBeenCalledWith("/created");
  });

  it("stays by the mount's own onStay where the form sits in a dialog, not by going back", async () => {
    const onStay = mock();
    await createSong("stay", onStay);

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("empties the form for the next one and focuses its first field, the toast linking to the record", async () => {
    await createSong("add-another");

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    expect(title.value).toBe("");
    expect((screen.getByLabelText("BPM") as HTMLInputElement).value).toBe("");
    // react-hook-form moves focus on the next tick.
    await waitFor(() => expect(document.activeElement === title).toBe(true));
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();

    toastLink()?.onClick();
    expect(push).toHaveBeenCalledWith("/created");
  });

  it("calls onCancel instead of router.back() when provided", () => {
    const onCancel = mock();
    render(
      <Harness<Draft, Parsed>
        fields={draftFields}
        defaultValues={{ title: "", bpm: "" }}
        submit={async () => okResult}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
