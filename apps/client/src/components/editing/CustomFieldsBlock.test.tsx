import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { customField } from "@/fields/custom-field-fixture";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { afterEach, describe, expect, it, mock } from "bun:test";

const format = defaultFormatters("UTC");

const patchField = mock(async () => ({ id: 1 }));
mock.module("@/actions/patch-field", () => ({ patchField }));
mock.module("sonner", () => ({ toast: { error: mock() } }));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

const { CustomFieldsBlock } = await import("./CustomFieldsBlock");
const { default: InlinePropertyEditor } =
  await import("./InlinePropertyEditor");

afterEach(() => {
  cleanup();
  patchField.mockClear();
  mayEdit = true;
});

const field = customField;

const FIELDS = [
  field(1, "Mood", "select", [
    { id: "a1", label: "Dark" },
    { id: "b2", label: "Mellow" },
  ]),
  field(3, "Release date", "date"),
  field(4, "Cleared", "checkbox"),
  field(5, "Stems", "url"),
  field(6, "Notes", "text"),
];

function renderBlock(values: Record<string, string | number | boolean>) {
  return render(
    <CustomFieldsBlock
      fields={FIELDS}
      values={values}
      entityType="track"
      entityId={7}
      format={format}
    />,
    { wrapper: MotionProvider }
  );
}

describe("the rail's custom fields block", () => {
  it("reads a number through the formatter set, as the table does", () => {
    render(
      <CustomFieldsBlock
        fields={[field(8, "Tempo", "number")]}
        values={{ cf_8: 1234.5 }}
        entityType="track"
        entityId={7}
        format={format}
      />,
      { wrapper: MotionProvider }
    );
    const tempo = screen.getByRole("button", { name: /Edit Tempo/ });
    expect(tempo.textContent).toBe(format.number(1234.5));
    expect(tempo.getAttribute("aria-label")).toBe(
      `${format.number(1234.5)} — Edit Tempo`
    );
  });

  it("shows each field under its name, a value as its type reads it", () => {
    renderBlock({
      cf_1: "b2",
      cf_3: "2026-11-06",
      cf_5: "https://stems.example.com/neon-rain",
    });
    expect(screen.getByRole("button", { name: /Edit Mood/ }).textContent).toBe(
      "Mellow"
    );
    expect(
      screen.getByRole("button", { name: /Edit Release date/ }).textContent
    ).toBe(format.date("2026-11-06"));
    const link = screen.getByRole("link", {
      name: "stems.example.com/neon-rain",
    });
    expect(link.getAttribute("href")).toBe(
      "https://stems.example.com/neon-rain"
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers to add a field that holds nothing", () => {
    renderBlock({});
    const notes = screen.getByRole("button", { name: /Edit Notes/ });
    expect(notes.textContent).toBe("Add notes");
    expect(notes.getAttribute("aria-label")).toBe("Add notes — Edit Notes");
  });

  it("shows a select value whose option was removed as the raw id", () => {
    renderBlock({ cf_1: "gone9" });
    expect(screen.getByRole("button", { name: /Edit Mood/ }).textContent).toBe(
      "gone9"
    );
  });

  it("saves an edit to the field's cf_ key", async () => {
    renderBlock({});
    fireEvent.click(screen.getByRole("button", { name: /Edit Notes/ }));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "comp the vocal" },
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "Enter" });
    });
    expect(patchField).toHaveBeenCalledWith(
      "track",
      7,
      "cf_6",
      "comp the vocal"
    );
  });

  it("clears a field saved empty", async () => {
    renderBlock({ cf_6: "old" });
    fireEvent.click(screen.getByRole("button", { name: /Edit Notes/ }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "" } });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "Enter" });
    });
    expect(patchField).toHaveBeenCalledWith("track", 7, "cf_6", null);
  });

  it("ticks a checkbox field in place", async () => {
    renderBlock({});
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Cleared" }));
    });
    expect(patchField).toHaveBeenCalledWith("track", 7, "cf_4", true);
  });

  it("saves a select field in one tap via ResponsivePicker", async () => {
    renderBlock({ cf_1: "b2" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Edit Mood/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Dark" }));
    });

    expect(patchField).toHaveBeenCalledWith("track", 7, "cf_1", "a1");
  });

  it("edits a link from its own button, the link itself left to open", () => {
    renderBlock({ cf_5: "https://a.example/x" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Stems" }));
    expect((screen.getByLabelText("Stems") as HTMLInputElement).value).toBe(
      "https://a.example/x"
    );
  });

  describe("for a viewer", () => {
    it("offers no control to edit a field", () => {
      mayEdit = false;
      renderBlock({
        cf_1: "b2",
        cf_3: "2026-11-06",
        cf_5: "https://stems.example.com/neon-rain",
        cf_6: "comp the vocal",
      });
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    it("reads each value as the text an editor's closed field shows", () => {
      mayEdit = false;
      renderBlock({
        cf_1: "b2",
        cf_3: "2026-11-06",
        cf_5: "https://stems.example.com/neon-rain",
        cf_6: "comp the vocal",
      });
      expect(screen.getByText("Mood")).toBeTruthy();
      expect(screen.getByText("Mellow")).toBeTruthy();
      expect(screen.getByText(format.date("2026-11-06"))).toBeTruthy();
      expect(screen.getByText("comp the vocal")).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "stems.example.com/neon-rain" })
          .getAttribute("href")
      ).toBe("https://stems.example.com/neon-rain");
    });

    it("shows an empty field as a dash, not an invitation to add", () => {
      mayEdit = false;
      renderBlock({});
      expect(screen.queryByText("Add notes")).toBeNull();
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("shows a checkbox field's state without letting it be flipped", async () => {
      mayEdit = false;
      renderBlock({ cf_4: true });
      const box = screen.getByRole("checkbox", {
        name: "Cleared",
      }) as HTMLInputElement;
      expect(box.checked).toBe(true);
      expect(box.readOnly).toBe(true);
      expect(box.tabIndex).toBe(-1);
      await act(async () => {
        fireEvent.click(box);
      });
      expect(patchField).not.toHaveBeenCalled();
    });
  });

  it("renders nothing for a project with no fields of the kind", () => {
    const { container } = render(
      <CustomFieldsBlock
        fields={[]}
        values={undefined}
        entityType="track"
        entityId={7}
        format={format}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("does not show Clear on an unset select field or when clearable={false}", async () => {
    renderBlock({});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Edit Mood/ }));
    });
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    cleanup();

    render(
      <MotionProvider>
        <InlinePropertyEditor
          label="Genre"
          value="ambient"
          type="select"
          entityType="track"
          entityId={7}
          fieldName="genre"
          clearable={false}
          options={[
            { value: "ambient", label: "Ambient" },
            { value: "techno", label: "Techno" },
          ]}
        />
      </MotionProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Edit Genre/ }));
    });
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
