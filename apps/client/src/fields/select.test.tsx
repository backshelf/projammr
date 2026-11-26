import { fieldKind } from "@/fields";
import { matchSeed } from "@/fields/scalar";
import { selectOptions } from "@/fields/select-fixture";
import type { FieldConfig, FieldValue } from "@/fields/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const config: FieldConfig = {
  options: selectOptions("Idea", "Demo", "Final Mix"),
};

/** A custom field's options, whose values are ids rather than labels. */
const byId: FieldConfig = {
  options: [
    // eslint-disable-next-line no-restricted-syntax -- an option's colour is user data the server stores as `#rrggbb`
    { value: "a1", label: "Dark", colour: "#5b4b8a" },
    { value: "b2", label: "Mellow" },
  ],
};

describe("a select whose values are ids", () => {
  it("commits the picked option's id", () => {
    const Editor = fieldKind("select").Editor!;
    const onCommit = mock();
    render(
      <Editor value="b2" config={byId} onCommit={onCommit} onCancel={mock()} />,
      { wrapper: MotionProvider }
    );
    pick("Dark");
    expect(onCommit).toHaveBeenCalledWith("a1");
  });

  it("shows an option by its label", () => {
    const Display = fieldKind("select").Display!;
    render(<Display value="b2" config={byId} />);
    expect(screen.getByText("Mellow")).toBeTruthy();
  });

  it("shows a value no option has any more as the raw id, faint", () => {
    const Display = fieldKind("select").Display!;
    render(<Display value="gone9" config={byId} />);
    const raw = screen.getByText("gone9");
    expect(raw.className).toContain("text-ink-faint");
    expect(raw.getAttribute("title")).toBe("Not one of the options any more");
  });
});

const renderEditor = (value: FieldValue, seed?: string) => {
  const Editor = fieldKind("select").Editor!;
  const onCommit = mock();
  const onCancel = mock();
  render(
    <Editor
      value={value}
      config={config}
      seed={seed}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
    { wrapper: MotionProvider }
  );
  return { onCommit, onCancel };
};

const pick = (label: string) => {
  // The trigger repeats the selected label, so text alone can match twice.
  const item = screen.getByRole("option", { name: label });
  fireEvent.pointerDown(item);
  fireEvent.click(item);
};

describe("the select editor", () => {
  it("opens its popup on mount with every option", () => {
    renderEditor("Demo");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Idea",
      "Demo",
      "Final Mix",
    ]);
  });

  it("commits the picked option and does not cancel when the popup closes", () => {
    const { onCommit, onCancel } = renderEditor("Demo");
    pick("Final Mix");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Final Mix");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels once on Escape and commits nothing", () => {
    const { onCommit, onCancel } = renderEditor("Demo");
    fireEvent.keyDown(screen.getAllByRole("option")[0]!, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels when the popup is dismissed by a click elsewhere", () => {
    const { onCommit, onCancel } = renderEditor("Demo");
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  describe("seeded by the character that opened it", () => {
    const selectedOption = () =>
      screen
        .getAllByRole("option")
        .find((o) => o.getAttribute("aria-selected") === "true")?.textContent;

    it("opens on the first option the seed starts, whatever its case", () => {
      renderEditor("Demo", "f");
      expect(selectedOption()).toBe("Final Mix");
      cleanup();
      renderEditor("Demo", "FINAL");
      expect(selectedOption()).toBe("Final Mix");
    });

    it("opens on the current value when nothing matches the seed", () => {
      renderEditor("Demo", "z");
      expect(selectedOption()).toBe("Demo");
    });

    it("opens on the current value when there is no seed", () => {
      renderEditor("Demo");
      expect(selectedOption()).toBe("Demo");
    });

    it("commits the seeded option when it is picked", () => {
      const { onCommit, onCancel } = renderEditor("Idea", "f");
      pick("Final Mix");
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("Final Mix");
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("commits an option that is already the value, not a cancel", () => {
      const { onCommit, onCancel } = renderEditor("Idea", "d");
      expect(selectedOption()).toBe("Demo");
      pick("Demo");
      expect(onCommit).toHaveBeenCalledWith("Demo");
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("commits the preselected option on Enter", () => {
      const { onCommit, onCancel } = renderEditor("Demo", "d");
      const option = screen.getByRole("option", { name: "Demo" });
      fireEvent.keyDown(option, { key: "Enter" });
      fireEvent.keyUp(option, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledWith("Demo");
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("still cancels on Escape", () => {
      const { onCommit, onCancel } = renderEditor("Idea", "d");
      fireEvent.keyDown(screen.getAllByRole("option")[0]!, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("returns to the rejected option, even when another starts with it", () => {
      renderEditor("Idea", "Demo");
      expect(selectedOption()).toBe("Demo");
    });
  });

  it("keeps its keys from reaching the grid", () => {
    const Editor = fieldKind("select").Editor!;
    const reached = mock();
    render(
      // The grid's handler is a React one on an ancestor of the editor.
      <div onKeyDown={reached}>
        <Editor
          value="Demo"
          config={config}
          onCommit={mock()}
          onCancel={mock()}
        />
      </div>,
      { wrapper: MotionProvider }
    );
    fireEvent.keyDown(screen.getAllByRole("option")[0]!, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getAllByRole("option")[0]!, { key: "x" });
    expect(reached).not.toHaveBeenCalled();
  });
});

describe("matching a seed to an option", () => {
  const same = (option: string) => option;

  it("takes the first option in order when two start with the seed", () => {
    expect(matchSeed("d", ["Draft", "Demo"], same)).toBe("Draft");
  });

  it("prefers an option that is the whole seed to an earlier one that starts with it", () => {
    expect(matchSeed("demo", ["Demo 2", "Demo"], same)).toBe("Demo");
  });

  it("matches nothing for an empty or missing seed, or an empty list", () => {
    expect(matchSeed("", ["Demo"], same)).toBeUndefined();
    expect(matchSeed(undefined, ["Demo"], same)).toBeUndefined();
    expect(matchSeed("d", [], same)).toBeUndefined();
  });
});

describe("the select draft input", () => {
  const Draft = fieldKind("select").DraftInput;

  it("carries the field's id, placeholder and invalid state", () => {
    render(
      <Draft
        raw=""
        config={{ ...config, placeholder: "Stage" }}
        onChange={mock()}
        invalid
        id="stage"
      />,
      { wrapper: MotionProvider }
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger.id).toBe("stage");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.textContent).toContain("Stage");
  });

  it("reports a pick as the option's text", () => {
    const onChange = mock();
    render(
      <Draft
        raw=""
        config={config}
        onChange={onChange}
        invalid={false}
        id="s"
      />,
      { wrapper: MotionProvider }
    );
    fireEvent.click(screen.getByRole("combobox"));
    pick("Demo");
    expect(onChange).toHaveBeenCalledWith("Demo");
  });
});
