import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { PeekTitleEditor } from "./PeekTitleEditor";

afterEach(cleanup);

function renderEditor(
  onSave: (title: string) => Promise<boolean> = async () => true,
  title = "Blue Hour"
) {
  const save = mock(onSave);
  const onEnd = mock<() => void>();
  render(<PeekTitleEditor title={title} onSave={save} onEnd={onEnd} />);
  const input = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Title",
  });
  return { input, save, onEnd };
}

const type = (input: HTMLInputElement, value: string) =>
  fireEvent.change(input, { target: { value } });

const press = async (input: HTMLInputElement, key: string) => {
  await act(async () => {
    fireEvent.keyDown(input, { key });
  });
};

describe("PeekTitleEditor", () => {
  it("focuses the input with the whole title selected", () => {
    const { input } = renderEditor();

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Blue Hour");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Blue Hour".length);
  });

  it("saves the trimmed title on Enter and ends", async () => {
    const { input, save, onEnd } = renderEditor();

    type(input, "  Golden Hour  ");
    await press(input, "Enter");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Golden Hour");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends without saving on Escape", async () => {
    const { input, save, onEnd } = renderEditor();

    type(input, "Golden Hour");
    await press(input, "Escape");

    expect(save).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("saves the edited title on blur", async () => {
    const { input, save, onEnd } = renderEditor();

    type(input, "  Golden Hour  ");
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Golden Hour");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends once when Escape is followed by the blur it causes", async () => {
    const { input, onEnd } = renderEditor();

    await press(input, "Escape");
    fireEvent.blur(input);

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("shows the required error for a blank title and does not save", async () => {
    const { input, save, onEnd } = renderEditor();

    type(input, "   ");
    await press(input, "Enter");

    expect(screen.getByRole("alert").textContent).toBe("Title is required");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id
    );
    expect(save).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("clears the error once the title is edited", async () => {
    const { input } = renderEditor();

    type(input, "");
    await press(input, "Enter");
    type(input, "Golden Hour");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("ends without saving when the title is unchanged", async () => {
    const { input, save, onEnd } = renderEditor();

    type(input, "  Blue Hour ");
    await press(input, "Enter");

    expect(save).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stays open with the error when the save reports failure", async () => {
    const { input, save, onEnd } = renderEditor(async () => false);

    type(input, "Golden Hour");
    await press(input, "Enter");

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("Save failed");
    expect(input.value).toBe("Golden Hour");
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("stays open with the error when the save throws", async () => {
    const { input, onEnd } = renderEditor(async () => {
      throw new Error("offline");
    });

    type(input, "Golden Hour");
    await press(input, "Enter");

    expect(screen.getByRole("alert").textContent).toBe("Save failed");
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("can save again after a failed save", async () => {
    let attempts = 0;
    const { input, save, onEnd } = renderEditor(async () => ++attempts > 1);

    type(input, "Golden Hour");
    await press(input, "Enter");
    await press(input, "Enter");

    expect(save).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("saves once when Enter is pressed again while a save is in flight", async () => {
    let finish: (saved: boolean) => void = () => {};
    const { input, save, onEnd } = renderEditor(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );

    type(input, "Golden Hour");
    await press(input, "Enter");
    await press(input, "Enter");

    expect(save).toHaveBeenCalledTimes(1);
    expect(input.readOnly).toBe(true);

    await act(async () => finish(true));

    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
  });

  it("does not end twice when a save resolves after Escape", async () => {
    let finish: (saved: boolean) => void = () => {};
    const { input, onEnd } = renderEditor(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );

    type(input, "Golden Hour");
    await press(input, "Enter");
    await press(input, "Escape");
    await act(async () => finish(true));

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape from reaching the document, where the sheet listens", async () => {
    const { input } = renderEditor();
    const reached = mock<() => void>();
    document.addEventListener("keydown", reached);

    await press(input, "Escape");
    document.removeEventListener("keydown", reached);

    expect(reached).not.toHaveBeenCalled();
  });
});
