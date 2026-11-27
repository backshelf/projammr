import { fieldKind } from "@/fields";
import type { FieldConfig, FieldValue } from "@/fields/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const renderEditor = (
  name: "text" | "number",
  value: FieldValue,
  { seed, config = {} }: { seed?: string; config?: FieldConfig } = {}
) => {
  const Editor = fieldKind(name).Editor!;
  const onCommit = mock();
  const onCancel = mock();
  render(
    <Editor
      value={value}
      config={config}
      seed={seed}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
  return {
    input: screen.getByRole("textbox") as HTMLInputElement,
    onCommit,
    onCancel,
  };
};

describe("the text editor", () => {
  it("starts from the formatted value and takes focus", () => {
    const { input } = renderEditor("text", "Kick");
    expect(input.value).toBe("Kick");
    expect(document.activeElement).toBe(input);
    expect(input.className).toContain("h-7");
    expect(input.className).toContain("-my-1");
  });

  it("starts from the seed instead of the value", () => {
    const { input } = renderEditor("text", "Kick", { seed: "s" });
    expect(input.value).toBe("s");
    expect(input.selectionStart).toBe(1);
  });

  it("commits the parsed value on Enter", () => {
    const { input, onCommit, onCancel } = renderEditor("text", "Kick");
    fireEvent.change(input, { target: { value: "  Snare " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Snare");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("commits null when a blank draft is allowed", () => {
    const { input, onCommit } = renderEditor("text", "Kick");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("shows Required inline and does not commit a blank required draft", () => {
    const { input, onCommit } = renderEditor("text", "Kick", {
      config: { required: true },
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { input, onCommit, onCancel } = renderEditor("text", "Kick");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on blur", () => {
    const { input, onCommit, onCancel } = renderEditor("text", "Kick");
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps its keys from reaching the grid", () => {
    const { input } = renderEditor("text", "Kick");
    const reached = mock();
    document.body.addEventListener("keydown", reached);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    document.body.removeEventListener("keydown", reached);
    expect(reached).not.toHaveBeenCalled();
  });
});

describe("the number editor", () => {
  it("commits a parsed number on Enter", () => {
    const { input, onCommit } = renderEditor("number", 3);
    expect(input.value).toBe("3");
    fireEvent.change(input, { target: { value: "4.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(4.5);
  });

  it("shows the parse error inline, stays open, and clears it on the next keystroke", () => {
    const { input, onCommit, onCancel } = renderEditor("number", 3);
    fireEvent.change(input, { target: { value: "12abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Must be a number");
    expect(alert.className).toContain("absolute");
    expect(alert.className).toContain("z-20");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "12" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("suggestions", () => {
  const config: FieldConfig = { suggestions: ["Ableton Live", "Logic"] };
  const datalistValues = (container: ParentNode) =>
    [...container.querySelectorAll("datalist option")].map((o) =>
      o.getAttribute("value")
    );

  it("offers the suggestions on the editor's input through a datalist", () => {
    const Editor = fieldKind("suggest").Editor!;
    const { container } = render(
      <Editor
        value="Logic"
        config={config}
        onCommit={mock()}
        onCancel={mock()}
      />
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    const datalist = container.querySelector("datalist")!;
    expect(input.getAttribute("list")).toBe(datalist.id);
    expect(datalistValues(container)).toEqual(["Ableton Live", "Logic"]);
  });

  it("commits free text that is not a suggestion", () => {
    const Editor = fieldKind("suggest").Editor!;
    const onCommit = mock();
    render(
      <Editor
        value={null}
        config={config}
        onCommit={onCommit}
        onCancel={mock()}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: " Reaper " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Reaper");
  });

  it("offers the suggestions on the draft input too", () => {
    const Draft = fieldKind("suggest").DraftInput;
    const { container } = render(
      <Draft
        raw=""
        config={config}
        onChange={mock()}
        invalid={false}
        id="daw"
      />
    );
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("list")).toBe(
      container.querySelector("datalist")!.id
    );
    expect(datalistValues(container)).toEqual(["Ableton Live", "Logic"]);
  });

  it("behaves as plain text when there are no suggestions", () => {
    const Editor = fieldKind("suggest").Editor!;
    const { container } = render(
      <Editor value="Logic" config={{}} onCommit={mock()} onCancel={mock()} />
    );
    expect(screen.getByRole("textbox").getAttribute("list")).toBeNull();
    expect(container.querySelector("datalist")).toBeNull();
  });

  it("gives a kind that does not suggest no datalist", () => {
    const Editor = fieldKind("text").Editor!;
    const { container } = render(
      <Editor
        value="Kick"
        config={config}
        onCommit={mock()}
        onCancel={mock()}
      />
    );
    expect(container.querySelector("datalist")).toBeNull();
  });
});

describe("the list editor", () => {
  it("shows the entries joined and commits them as an array", () => {
    const Editor = fieldKind("list").Editor!;
    const onCommit = mock();
    render(
      <Editor
        value={["Ada", "Bea"]}
        config={{}}
        onCommit={onCommit}
        onCancel={mock()}
      />
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Ada, Bea");
    fireEvent.change(input, { target: { value: "Ada, Bea,, Cy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(["Ada", "Bea", "Cy"]);
  });
});

describe("the draft inputs", () => {
  it("reports each edit as raw text and marks an invalid field", () => {
    const Draft = fieldKind("number").DraftInput;
    const onChange = mock();
    render(
      <Draft
        raw="1"
        config={{ placeholder: "BPM", required: true }}
        onChange={onChange}
        invalid
        id="bpm"
      />
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.id).toBe("bpm");
    expect(input.placeholder).toBe("BPM *");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(input, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith("12");
  });
});
