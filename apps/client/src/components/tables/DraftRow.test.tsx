import type { FieldConfig } from "@/fields/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

import { DraftRow, type NewRowConfig } from "./DraftRow";
import type { CoercedDraft } from "./new-row";

afterEach(cleanup);

const mixing: NonNullable<FieldConfig["statuses"]>[number] = {
  id: 2,
  name: "Mixing",
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  percentage: 50,
  description: null,
  projectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const setup = ({
  fields,
  columnIds,
  onCreate = mock<NewRowConfig["onCreate"]>(async () => true),
  defaults,
  ...props
}: {
  fields: NewRowConfig["fields"];
  defaults?: NewRowConfig["defaults"];
  columnIds?: string[];
  onCreate?: NewRowConfig["onCreate"];
  initialValues?: CoercedDraft;
  lockedFields?: string[];
  autoFocus?: boolean;
  onCancel?: () => void;
}) => {
  render(
    <table>
      <tbody>
        <DraftRow
          config={{ fields, onCreate, defaults }}
          columnIds={columnIds ?? Object.keys(fields)}
          {...props}
        />
      </tbody>
    </table>
  );
  return { onCreate };
};

const createButton = () => screen.getByRole("button", { name: "Create row" });
const create = () => act(async () => createButton().click());

describe("DraftRow", () => {
  it("starts a field with its default, editable, and creates what it holds", async () => {
    const { onCreate } = setup({
      fields: { title: { type: "text" }, artists: { type: "list" } },
      defaults: { artists: "Ana, Bo" },
    });
    const [, artists] = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(artists!.value).toBe("Ana, Bo");

    fireEvent.change(artists!, { target: { value: "Cy" } });
    await create();

    expect(onCreate).toHaveBeenCalledWith({ title: null, artists: ["Cy"] });
  });

  it("sends a default the user cleared as blank", async () => {
    const { onCreate } = setup({
      fields: { title: { type: "text" }, artists: { type: "list" } },
      defaults: { artists: "Ana" },
    });
    const [, artists] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(artists!, { target: { value: "" } });
    await create();

    expect(onCreate).toHaveBeenCalledWith({ title: null, artists: [] });
  });

  it("returns to its defaults after a create", async () => {
    setup({
      fields: { title: { type: "text" } },
      defaults: { title: "Untitled" },
    });
    const title = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Song" } });
    await create();

    expect(title.value).toBe("Untitled");
  });

  it("lets a group seed override a default and keeps the field locked", async () => {
    const { onCreate } = setup({
      fields: { title: { type: "text" }, collection: { type: "number" } },
      defaults: { collection: "9", title: "Untitled" },
      initialValues: { collection: 5 },
      lockedFields: ["collection"],
    });
    const [, collection] = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(collection!.value).toBe("5");
    expect(collection!.closest("[inert]")).not.toBeNull();

    await create();

    expect(onCreate).toHaveBeenCalledWith({ title: "Untitled", collection: 5 });
  });

  it("focuses the first field that is not locked when opened on request", () => {
    setup({
      fields: { collection: { type: "number" }, title: { type: "text" } },
      initialValues: { collection: 5 },
      lockedFields: ["collection"],
      autoFocus: true,
    });
    const [, title] = screen.getAllByRole("textbox");
    expect(document.activeElement).toBe(title!);
  });

  it("leaves focus alone unless it was opened on request", () => {
    setup({ fields: { title: { type: "text" } } });
    expect(document.activeElement).toBe(document.body);
  });

  it("creates the parsed draft when Enter is pressed in a text box", async () => {
    const { onCreate } = setup({
      fields: {
        title: { type: "text", required: true },
        bpm: { type: "number" },
        mastered: { type: "checkbox" },
      },
    });
    const [title, bpm] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(title!, { target: { value: "  Song " } });
    fireEvent.change(bpm!, { target: { value: "120" } });
    await act(async () => {
      fireEvent.keyDown(title!, { key: "Enter" });
    });
    expect(onCreate).toHaveBeenCalledWith({
      title: "Song",
      bpm: 120,
      mastered: false,
    });
  });

  it("creates a ticked checkbox as true", async () => {
    const { onCreate } = setup({ fields: { mastered: { type: "checkbox" } } });
    fireEvent.click(screen.getByRole("checkbox"));
    await create();
    expect(onCreate).toHaveBeenCalledWith({ mastered: true });
  });

  it("blocks create on a value its kind rejects and says why", async () => {
    const { onCreate } = setup({
      fields: { bpm: { type: "number" }, releaseDate: { type: "date" } },
    });
    const [bpm] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(bpm!, { target: { value: "fast" } });
    await create();

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
    expect(bpm!.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the parse error rather than Required for a required field that fails", async () => {
    setup({ fields: { bpm: { type: "number", required: true } } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    await create();
    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
  });

  it("says Required for an empty required field", async () => {
    const { onCreate } = setup({
      fields: { title: { type: "text", required: true } },
    });
    await create();
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Required");
  });

  it("clears a field's error once it is edited", async () => {
    setup({ fields: { bpm: { type: "number" } } });
    const bpm = screen.getByRole("textbox");
    fireEvent.change(bpm, { target: { value: "fast" } });
    await create();
    fireEvent.change(bpm, { target: { value: "12" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(bpm.getAttribute("aria-invalid")).toBeNull();
  });

  it("creates a locked field at its seed and lets nothing edit it", async () => {
    const { onCreate } = setup({
      fields: {
        title: { type: "text" },
        statusId: { type: "status", statuses: [mixing] },
      },
      initialValues: { statusId: 2 },
      lockedFields: ["statusId"],
    });
    const locked = screen.getByText(/mixing/i).closest("[inert]");
    expect(locked).not.toBeNull();
    await create();
    expect(onCreate).toHaveBeenCalledWith({ title: null, statusId: 2 });
  });

  it("shuts every field while it saves", async () => {
    let finish: (ok: boolean) => void = () => {};
    const onCreate = mock(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );
    setup({ fields: { title: { type: "text" } }, onCreate });
    act(() => createButton().click());
    expect(screen.getByRole("textbox").closest("[inert]")).not.toBeNull();
    await act(async () => finish(true));
    expect(screen.getByRole("textbox").closest("[inert]")).toBeNull();
  });

  it("cancels on Escape in a field", () => {
    const onCancel = mock();
    setup({ fields: { title: { type: "text" } }, onCancel });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("DraftRow with custom fields", () => {
  const fields: NewRowConfig["fields"] = {
    title: { type: "text", required: true },
    cf_6: { type: "text", label: "Notes" },
    cf_4: { type: "checkbox", label: "Cleared" },
  };

  it("shows a custom field's input only while its column is visible", () => {
    setup({ fields, columnIds: ["title", "cf_6"] });
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("sends a visible custom field and leaves a hidden one out", async () => {
    const { onCreate } = setup({ fields, columnIds: ["title", "cf_6"] });
    const [title, notes] = screen.getAllByRole("textbox");
    fireEvent.change(title!, { target: { value: "Night Drive" } });
    fireEvent.change(notes!, { target: { value: "comp the vocal" } });
    await create();
    expect(onCreate).toHaveBeenCalledWith({
      title: "Night Drive",
      cf_6: "comp the vocal",
    });
  });

  it("sends a hidden custom field a group header seeded", async () => {
    const { onCreate } = setup({
      fields,
      columnIds: ["title"],
      initialValues: { cf_4: true },
      lockedFields: ["cf_4"],
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Night Drive" },
    });
    await create();
    expect(onCreate).toHaveBeenCalledWith({ title: "Night Drive", cf_4: true });
  });
});
