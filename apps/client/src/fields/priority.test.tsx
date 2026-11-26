import { FIELD_KINDS } from "@/fields";
import {
  HIGH as high,
  LEVEL_COLOURS,
  LOW as low,
  MEDIUM as medium,
  NONE as none,
  scaleLevel as level,
  SEEDED_SCALE,
  URGENT as urgent,
} from "@/fields/priority-fixture";
import type { FieldConfig, FieldValue } from "@/fields/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const { parse, format, Editor, DraftInput, Display, optimisticPatch } =
  FIELD_KINDS.priority;

const scale: FieldConfig = { priorityLevels: SEEDED_SCALE };

const renderEditor = (value: FieldValue, seed?: string) => {
  const onCommit = mock();
  const onCancel = mock();
  render(
    <Editor
      value={value}
      config={scale}
      seed={seed}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
    { wrapper: MotionProvider }
  );
  return { onCommit, onCancel };
};

const pick = (name: string) => {
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
};

describe("priority parse", () => {
  it.each([none, low, medium, high, urgent])(
    "parses the level named $name to its id",
    (named) => {
      expect(parse(named.name, scale)).toEqual({ ok: true, value: named.id });
    }
  );

  it("parses a level's id to that id", () => {
    expect(parse("14", scale)).toEqual({ ok: true, value: 14 });
  });

  it("parses a name ignoring case and surrounding space", () => {
    expect(parse(" URGENT ", scale)).toEqual({ ok: true, value: 15 });
  });

  it("prefers the exact spelling when two levels differ only in case", () => {
    const shouty = level(16, "HIGH", 5);
    const config = { priorityLevels: [none, high, shouty] };
    expect(parse("HIGH", config)).toEqual({ ok: true, value: 16 });
    expect(parse("High", config)).toEqual({ ok: true, value: 14 });
    expect(parse("high", config)).toEqual({ ok: true, value: 14 });
  });

  it("reads a numeric name as that level, not as the id it spells", () => {
    const numeric = level(20, "14", 5);
    expect(parse("14", { priorityLevels: [none, high, numeric] })).toEqual({
      ok: true,
      value: 20,
    });
  });

  it("parses blank to the project's default level, even when required", () => {
    expect(parse("", scale)).toEqual({ ok: true, value: 11 });
    expect(parse("  ", { ...scale, required: true })).toEqual({
      ok: true,
      value: 11,
    });
  });

  it("leaves blank to the server when there is no scale to read a default from", () => {
    expect(parse("", {})).toEqual({ ok: true, value: null });
    expect(parse("", { required: true })).toEqual({
      ok: false,
      error: "Required",
    });
  });

  it.each(["critical", "99", "Hig"])("rejects %p as not a priority", (raw) => {
    expect(parse(raw, scale)).toEqual({ ok: false, error: "Not a priority" });
  });

  it("rejects every name when the scale is missing", () => {
    expect(parse("High", {})).toEqual({ ok: false, error: "Not a priority" });
  });
});

describe("priority format", () => {
  it("names a level id", () => {
    expect(format(13, scale)).toBe("Medium");
  });

  it("formats null as an empty string", () => {
    expect(format(null, scale)).toBe("");
  });

  it("keeps an id the scale no longer has as the id itself", () => {
    expect(format(99, scale)).toBe("99");
  });

  it("round-trips through parse, as a copied cell pastes back", () => {
    for (const each of scale.priorityLevels!) {
      expect(parse(format(each.id, scale), scale)).toEqual({
        ok: true,
        value: each.id,
      });
    }
  });
});

describe("priority optimistic patch", () => {
  it("patches the row with the level id and the level object", () => {
    expect(optimisticPatch(14, scale)).toEqual({
      priorityId: 14,
      priority: high,
    });
  });

  it("patches a numeric string id the way a number does", () => {
    expect(optimisticPatch("14", scale)).toEqual({
      priorityId: 14,
      priority: high,
    });
  });

  it("leaves the row alone for a value no level stands behind", () => {
    expect(optimisticPatch(null, scale)).toEqual({});
    expect(optimisticPatch(99, scale)).toEqual({});
  });

  it("saves as priorityId", () => {
    expect(FIELD_KINDS.priority.saveAs).toBe("priorityId");
  });
});

describe("the priority editor", () => {
  it("opens with the project's levels, bottom first", () => {
    renderEditor(12);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Urgent",
    ]);
  });

  it("wears each option in its level's colour", () => {
    renderEditor(12);
    const chip = screen
      .getByRole("option", { name: "High" })
      .querySelector<HTMLElement>('[data-slot="status-chip"]');
    expect(chip?.style.getPropertyValue("--status")).toBe(LEVEL_COLOURS.ink);
  });

  it("commits the picked level's id and does not cancel", () => {
    const { onCommit, onCancel } = renderEditor(12);
    pick("High");
    expect(onCommit).toHaveBeenCalledWith(14);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels when the menu closes without a pick", () => {
    const { onCommit, onCancel } = renderEditor(12);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("starts on the default level when the value is not a level", () => {
    renderEditor(null);
    expect(screen.getByRole("combobox").textContent).toBe("None");
  });

  describe("seeded by the character that opened it", () => {
    const shown = () => screen.getByRole("combobox").textContent;

    it("opens on the level whose name the seed starts, whatever its case", () => {
      renderEditor(12, "h");
      expect(shown()).toBe("High");
      cleanup();
      renderEditor(12, "URG");
      expect(shown()).toBe("Urgent");
    });

    it("opens on the current level when nothing matches the seed", () => {
      renderEditor(12, "z");
      expect(shown()).toBe("Low");
    });

    it("opens on the current level when there is no seed", () => {
      renderEditor(12);
      expect(shown()).toBe("Low");
    });

    it("returns to the level a rejected save carried back", () => {
      renderEditor(12, format(14, scale));
      expect(shown()).toBe("High");
    });

    it("commits a level that is already the value, not a cancel", () => {
      const { onCommit, onCancel } = renderEditor(12, "h");
      pick("High");
      expect(onCommit).toHaveBeenCalledWith(14);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("commits the preselected level on Enter", () => {
      const { onCommit, onCancel } = renderEditor(14, "h");
      const option = screen.getByRole("option", { name: "High" });
      fireEvent.keyDown(option, { key: "Enter" });
      fireEvent.keyUp(option, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledWith(14);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("still cancels on Escape", () => {
      const { onCommit, onCancel } = renderEditor(12, "h");
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });
  });
});

describe("the priority draft input", () => {
  const renderDraft = (raw: string, onChange = mock()) => {
    render(
      <DraftInput
        raw={raw}
        config={scale}
        onChange={onChange}
        invalid={false}
        id="priority"
      />,
      { wrapper: MotionProvider }
    );
    return screen.getByRole("combobox");
  };

  it("shows the raw level and reports a pick as the level's name", () => {
    const onChange = mock();
    const trigger = renderDraft("Medium", onChange);
    expect(trigger.textContent).toBe("Medium");
    expect(trigger.id).toBe("priority");

    fireEvent.click(trigger);
    pick("Urgent");
    expect(onChange).toHaveBeenCalledWith("Urgent");
  });

  it("shows the default level while blank, which is what blank saves", () => {
    expect(renderDraft("").textContent).toBe("None");
  });

  it("shows a level a group header seeded by its id", () => {
    expect(renderDraft("14").textContent).toBe("High");
  });

  it("flags itself invalid", () => {
    render(
      <DraftInput
        raw=""
        config={scale}
        onChange={mock()}
        invalid
        id="priority"
      />,
      { wrapper: MotionProvider }
    );
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe(
      "true"
    );
  });
});

describe("the priority display", () => {
  it("renders a level id as its badge, the default level included", () => {
    render(<Display value={15} config={scale} />);
    expect(screen.getByText("Urgent")).toBeTruthy();
    cleanup();
    render(<Display value={11} config={scale} />);
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("falls back to the id for a level the scale no longer has", () => {
    render(<Display value={99} config={scale} />);
    expect(screen.getByText("99")).toBeTruthy();
  });
});
