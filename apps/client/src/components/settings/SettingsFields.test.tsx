import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { CustomField } from "@workspace/api/api";

const createCustomField = mock(async () => ({ ok: true as const }));
const updateCustomField = mock(async () => ({ ok: true as const }));
const deleteCustomField = mock(async () => ({ ok: true as const }));
const reorderCustomFields = mock(async () => ({ ok: true as const }));

mock.module("@/actions/custom-fields", () => ({
  createCustomField,
  updateCustomField,
  deleteCustomField,
  reorderCustomFields,
}));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { SettingsFields } = await import("./SettingsFields");
const { DEFAULT_OPTION_COLOUR } = await import("./FieldOptionsEditor");

const now = "2026-01-01T00:00:00.000Z";

const field = (overrides: Partial<CustomField>): CustomField => ({
  id: 1,
  projectId: 7,
  kind: "track",
  name: "Mood",
  type: "text",
  options: [],
  rank: 0,
  valueCount: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const mood = field({ id: 1, name: "Mood", type: "text", valueCount: 0 });
const energy = field({
  id: 2,
  name: "Energy",
  type: "select",
  valueCount: 3,
  optionCounts: { o1: 3 },
  rank: 1,
  options: [
    // eslint-disable-next-line no-restricted-syntax -- an option's colour is a hex value in the payload
    { id: "o1", label: "High", colour: "#ff0000" },
    { id: "o2", label: "Unused" },
  ],
});

const trackFields = [mood, energy];

afterEach(() => {
  cleanup();
  createCustomField.mockClear();
  updateCustomField.mockClear();
  deleteCustomField.mockClear();
  reorderCustomFields.mockClear();
  mayEdit = true;
});

async function renderFields(
  confirms: { field?: boolean; fieldOption?: boolean } = {}
) {
  await act(async () => {
    render(
      <PoliciesProvider
        policies={{
          ...DEFAULT_POLICIES,
          feedback: {
            ...DEFAULT_POLICIES.feedback,
            confirmDeletes: {
              ...DEFAULT_POLICIES.feedback.confirmDeletes,
              ...confirms,
            },
          },
        }}
      >
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      </PoliciesProvider>
    );
  });
}

describe("SettingsFields", () => {
  it("gives an editor an Add control per list and edit and delete buttons per field", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    expect(screen.getAllByRole("button", { name: "Add field" })).toHaveLength(
      2
    );
    expect(screen.getByRole("button", { name: "Edit Mood" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Energy" })).toBeTruthy();
  });

  it("shows a viewer both lists with no forms, handles or bins", async () => {
    mayEdit = false;
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    expect(screen.getByText("Mood")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move Mood/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
  });

  it("adds a text field through the create form", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add field" })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Loudness" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(createCustomField).toHaveBeenCalledWith(7, {
      kind: "track",
      name: "Loudness",
      type: "text",
    });
  });

  it("adds a select field with an option through the create form", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add field" })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Vibe" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Type" }));
    const option = await screen.findByRole("option", { name: "Select" });
    // A pointerdown must land on the item before its click counts as a real
    // pick: Base UI ignores a click with no pointerdown of its own.
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    fireEvent.change(screen.getByLabelText("Option 1 label"), {
      target: { value: "Bright" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(createCustomField).toHaveBeenCalledWith(7, {
      kind: "track",
      name: "Vibe",
      type: "select",
      options: [{ label: "Bright", colour: DEFAULT_OPTION_COLOUR }],
    });
  });

  it("renames a field through its edit form", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Mood" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Feel" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(updateCustomField).toHaveBeenCalledWith(7, 1, { name: "Feel" });
  });

  it("renames a select field whose option has no colour, sending the name alone", async () => {
    const plain = field({
      id: 3,
      name: "Key",
      type: "select",
      options: [{ id: "k1", label: "C major" }],
    });
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={[plain]}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Key" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Scale" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    // Untouched options stay off the request: they would replace whatever
    // another editor has added since the form opened.
    expect(updateCustomField).toHaveBeenCalledWith(7, 3, { name: "Scale" });
  });

  it("saves a text field after an option row was added under Select and the type changed", async () => {
    await act(async () => {
      render(
        <SettingsFields projectId={7} trackFields={[]} collectionFields={[]} />
      );
    });

    const pick = async (name: string) => {
      fireEvent.click(screen.getByRole("combobox", { name: "Type" }));
      const option = await screen.findByRole("option", { name });
      fireEvent.pointerDown(option);
      fireEvent.click(option);
    };

    fireEvent.click(screen.getAllByRole("button", { name: "Add field" })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Notes" },
    });
    await pick("Select");
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    await pick("Text");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(createCustomField).toHaveBeenCalledWith(7, {
      kind: "track",
      name: "Notes",
      type: "text",
    });
  });

  it("shows the type as read-only text with why, on an existing field", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Mood" }));
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
    expect(screen.getByLabelText("Type")).toHaveProperty("textContent", "Text");
    expect(
      screen.getByText("A field's type can't change once it exists.")
    ).toBeTruthy();
  });

  it("edits a select field's options and saves the full list", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    fireEvent.change(screen.getByLabelText("Option 3 label"), {
      target: { value: "Low" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(updateCustomField).toHaveBeenCalledWith(7, 2, {
      name: "Energy",
      options: [
        ...energy.options,
        { label: "Low", colour: DEFAULT_OPTION_COLOUR },
      ],
    });
  });

  it("removes an option no row holds without asking", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 2" }));

    expect(screen.queryByText(/will show its id until edited/)).toBeNull();
    expect(screen.queryByLabelText("Option 2 label")).toBeNull();
  });

  it("says one row holds an option in the singular", async () => {
    const single = field({
      id: 3,
      name: "Key",
      type: "select",
      valueCount: 1,
      optionCounts: { k1: 1 },
      options: [{ id: "k1", label: "Am" }],
    });
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={[single]}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Key" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));

    expect(
      screen.getByText(
        "1 row holds this option and will show its id until edited."
      )
    ).toBeTruthy();
  });

  it("asks, with the row count, before removing an option rows hold", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));

    expect(
      screen.getByText(
        "3 rows hold this option and will show its id until edited."
      )
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove option" }));
    });
    expect(screen.queryByDisplayValue("High")).toBeNull();
  });

  it("sends every field id of the kind, once, on a reorder", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Energy up" }));
    });

    expect(reorderCustomFields).toHaveBeenCalledWith(7, [2, 1]);
  });

  it("goes back to the server's order when a reorder fails", async () => {
    reorderCustomFields.mockImplementationOnce(
      async () => ({ error: "List every track field exactly once" }) as never
    );
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Energy up" }));
    });

    const names = screen
      .getAllByRole("button", { name: /^Reorder / })
      .map((handle) => handle.getAttribute("aria-label"));
    expect(names).toEqual(["Reorder Mood", "Reorder Energy"]);
  });

  it("asks with a value count before deleting a field that holds values", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Energy" }));
    expect(screen.getByText("3 values will be lost.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    });
    expect(deleteCustomField).toHaveBeenCalledWith(7, 2);
  });

  it("asks plainly before deleting a field with no values", async () => {
    await act(async () => {
      render(
        <SettingsFields
          projectId={7}
          trackFields={trackFields}
          collectionFields={[]}
        />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Mood" }));
    expect(screen.getByText("Delete Mood?")).toBeTruthy();
    expect(screen.queryByText(/will be lost/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    });
    expect(deleteCustomField).toHaveBeenCalledWith(7, 1);
  });

  it("keeps the field when the confirm is cancelled", async () => {
    await renderFields();

    fireEvent.click(screen.getByRole("button", { name: "Delete Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteCustomField).not.toHaveBeenCalled();
  });

  it("deletes a field straight away when custom field confirms are off", async () => {
    await renderFields({ field: false });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Energy" }));
    });

    expect(deleteCustomField).toHaveBeenCalledWith(7, 2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the option when the confirm is cancelled", async () => {
    await renderFields();

    fireEvent.click(screen.getByRole("button", { name: "Edit Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByDisplayValue("High")).toBeTruthy();
  });

  it("removes an option rows hold straight away when field option confirms are off", async () => {
    await renderFields({ fieldOption: false });

    fireEvent.click(screen.getByRole("button", { name: "Edit Energy" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));
    });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByDisplayValue("High")).toBeNull();
  });
});
