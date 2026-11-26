import EditableCell, {
  type EditableCellProps,
} from "@/components/tables/EditableCell";
import type { CellValue } from "@/components/tables/generic-table-types";
import { HIGH, SEEDED_SCALE } from "@/fields/priority-fixture";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const mount = (props: Partial<EditableCellProps> = {}) => {
  const onSave = mock<(value: CellValue) => Promise<boolean>>(async () => true);
  const onEditEnd = mock();
  render(
    <EditableCell
      value="Kick"
      config={{ type: "text" }}
      isEditing
      onSave={onSave}
      onEditEnd={onEditEnd}
      {...props}
    />
  );
  return { onSave, onEditEnd };
};

const enterText = async (text: string) => {
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  return input;
};

describe("editing a cell", () => {
  it("saves what the kind parsed and leaves edit mode", async () => {
    const { onSave, onEditEnd } = mount();
    await enterText("  Snare ");
    expect(onSave).toHaveBeenCalledWith("Snare");
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it("saves a number kind's value as a number", async () => {
    const { onSave } = mount({ value: 4, config: { type: "number" } });
    await enterText("12");
    expect(onSave).toHaveBeenCalledWith(12);
  });

  it("shows the kind's parse error and saves nothing", async () => {
    const { onSave, onEditEnd } = mount({
      value: 4,
      config: { type: "number" },
    });
    await enterText("abc");
    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
    expect(onSave).not.toHaveBeenCalled();
    expect(onEditEnd).not.toHaveBeenCalled();
  });

  it("refuses a blank value for a required field", async () => {
    const { onSave } = mount({ config: { type: "text", required: true } });
    await enterText("");
    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves null for a blank value that is allowed", async () => {
    const { onSave } = mount();
    await enterText("");
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("stays in edit mode with the rejected text when the save fails", async () => {
    const onSave = mock<(value: CellValue) => Promise<boolean>>(
      async () => false
    );
    const { onEditEnd } = mount({ onSave });
    await enterText("Snare");
    expect(screen.getByRole("alert").textContent).toBe(
      "Save failed — try again"
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Snare"
    );
    expect(onEditEnd).not.toHaveBeenCalled();
  });

  it("takes another try after a failed save", async () => {
    const onSave = mock<(value: CellValue) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { onEditEnd } = mount({ onSave });
    await enterText("Snare");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it("leaves edit mode on Escape without saving", () => {
    const { onSave, onEditEnd } = mount();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("a cell that is not being edited", () => {
  it("draws the column's own output in preference to anything else", () => {
    mount({ isEditing: false, display: <a href="/t/1">Kick</a> });
    expect(screen.getByRole("link").textContent).toBe("Kick");
  });

  it("draws the kind's Display when the column has no output of its own", () => {
    mount({
      isEditing: false,
      value: HIGH.id,
      config: { type: "priority", priorityLevels: SEEDED_SCALE },
    });
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("draws the formatted value when the kind has no Display", () => {
    mount({ isEditing: false, value: 7, config: { type: "number" } });
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("draws a dash for a blank value even when the column has output", () => {
    mount({ isEditing: false, value: null, display: <a href="/t/1">Kick</a> });
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("mounts no editor", () => {
    mount({ isEditing: false });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
