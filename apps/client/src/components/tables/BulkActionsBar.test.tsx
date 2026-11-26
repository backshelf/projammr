import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Label, PriorityLevel } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { LEVEL_COLOURS, scaleLevel } from "@/fields/priority-fixture";
import { customField } from "@/fields/custom-field-fixture";

import { BulkActionsBar } from "./BulkActionsBar";

const LABELS: Label[] = [
  {
    id: 1,
    name: "Mix Ready",
    // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
    colourHex: "#94A3B8",
    projectId: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Needs Vocals",
    // eslint-disable-next-line no-restricted-syntax -- a label's own colourHex, not a class name
    colourHex: "#94A3B8",
    projectId: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

// A user-defined scale with no seeded names, so nothing here leans on them.
const LEVELS: PriorityLevel[] = [
  scaleLevel(21, "Someday", 0, { colour: LEVEL_COLOURS.faint }),
  scaleLevel(22, "Soon", 1, { isDefault: true }),
  scaleLevel(23, "Now", 2, { colour: LEVEL_COLOURS.picked }),
];

const BASE_PROPS = {
  selectedCount: 2,
  entityLabel: "track",
  allMatching: false,
  canSelectAllMatching: false,
  onSelectAllMatching: () => {},
  onClear: () => {},
};

afterEach(cleanup);

function renderBar(
  overrides: Partial<React.ComponentProps<typeof BulkActionsBar>> = {}
) {
  return render(<BulkActionsBar {...BASE_PROPS} {...overrides} />, {
    wrapper: MotionProvider,
  });
}

// Base UI's menu trigger opens on pointerdown, which happy-dom's synthetic
// pointer event does not carry the button information for; the key it does
// support is what `DataTable.selection.test.tsx` opens a trigger with too.
async function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
  return screen.findByRole("menu", { name });
}

async function clickItem(name: string) {
  await act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  });
}

describe("BulkActionsBar", () => {
  it("renders no optional menu when its handler is absent", () => {
    renderBar();

    expect(screen.queryByRole("button", { name: "Set status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Labels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Priority" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move to project…" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("renders each menu only when its own handler is supplied", () => {
    renderBar({
      labels: LABELS,
      onSetLabels: mock(),
      priorityLevels: LEVELS,
      onSetPriority: mock(),
      onMove: mock(),
    });

    expect(screen.getByRole("button", { name: "Labels" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Priority" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Move to project…" })
    ).toBeDefined();
  });

  it("disables the Labels trigger with 'No labels yet' when the project has none", () => {
    renderBar({ labels: [], onSetLabels: mock() });

    const trigger = screen.getByRole("button", { name: "No labels yet" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });

  it("adds a label", async () => {
    const onSetLabels =
      mock<(add: number[], remove: number[]) => void | Promise<void>>();
    renderBar({ labels: LABELS, onSetLabels });

    await openMenu("Labels");
    await clickItem("Add label…");
    await clickItem("Mix Ready");

    expect(onSetLabels).toHaveBeenCalledTimes(1);
    expect(onSetLabels).toHaveBeenCalledWith([1], []);
  });

  it("removes a label", async () => {
    const onSetLabels =
      mock<(add: number[], remove: number[]) => void | Promise<void>>();
    renderBar({ labels: LABELS, onSetLabels });

    await openMenu("Labels");
    await clickItem("Remove label…");
    await clickItem("Needs Vocals");

    expect(onSetLabels).toHaveBeenCalledTimes(1);
    expect(onSetLabels).toHaveBeenCalledWith([], [2]);
  });

  it("offers the project's own levels, bottom first, each in its colour", async () => {
    renderBar({ priorityLevels: LEVELS, onSetPriority: mock() });

    const menu = await openMenu("Priority");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Someday",
      "Soon",
      "Now",
    ]);
    const chip = items[2]!.querySelector<HTMLElement>(
      '[data-slot="status-chip"]'
    );
    expect(chip?.style.getPropertyValue("--status")).toBe(LEVEL_COLOURS.picked);
  });

  it("calls onSetPriority with the chosen level's id", async () => {
    const onSetPriority = mock<(priorityId: number) => void | Promise<void>>();
    renderBar({ priorityLevels: LEVELS, onSetPriority });

    await openMenu("Priority");
    await clickItem("Soon");

    expect(onSetPriority).toHaveBeenCalledTimes(1);
    expect(onSetPriority).toHaveBeenCalledWith(22);
  });

  it("offers no Priority menu while the scale has not loaded", () => {
    renderBar({ priorityLevels: [], onSetPriority: mock() });

    expect(screen.queryByRole("button", { name: "Priority" })).toBeNull();
  });

  it("calls onMove when Move is clicked", () => {
    const onMove = mock<() => void>();
    renderBar({ onMove });

    fireEvent.click(screen.getByRole("button", { name: "Move to project…" }));

    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("renders declared actions before Move, in the order given", () => {
    renderBar({
      actions: [
        { id: "archive", label: "Archive", onSelect: () => {} },
        { id: "unarchive", label: "Unarchive", onSelect: () => {} },
      ],
      onMove: () => {},
    });

    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    const move = names.indexOf("Move to project…");
    expect(names.slice(move - 2, move)).toEqual(["Archive", "Unarchive"]);
  });

  it("calls a declared action's onSelect when its button is clicked", async () => {
    const onSelect = mock<() => void>();
    renderBar({ actions: [{ id: "archive", label: "Archive", onSelect }] });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("disables every action while a declared action runs", async () => {
    let finish = () => {};
    const onSelect = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    renderBar({
      actions: [{ id: "archive", label: "Archive", onSelect }],
      onMove: () => {},
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    });

    const archive = screen.getByRole<HTMLButtonElement>("button", {
      name: "Archive",
    });
    const move = screen.getByRole<HTMLButtonElement>("button", {
      name: "Move to project…",
    });
    expect(archive.disabled).toBe(true);
    expect(move.disabled).toBe(true);

    await act(async () => {
      finish();
    });

    expect(archive.disabled).toBe(false);
  });
});

describe("BulkActionsBar Set field…", () => {
  const FIELDS = [
    customField(2, "Energy", "number"),
    customField(1, "Mood", "select", [
      { id: "a1", label: "Dark" },
      { id: "b2", label: "Mellow" },
    ]),
  ];

  async function openSetField(onSetField = mock()) {
    renderBar({ fields: FIELDS, onSetField });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set field…" }));
    });
    return onSetField;
  }

  const apply = () =>
    act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Apply to selection" })
      );
    });

  it("is absent when the project defines no fields", () => {
    renderBar({ fields: [], onSetField: mock() });
    expect(screen.queryByRole("button", { name: "Set field…" })).toBeNull();
  });

  it("applies a typed value to the first field, parsed by its kind", async () => {
    const onSetField = await openSetField();
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "8" },
    });
    await apply();
    expect(onSetField).toHaveBeenCalledWith("cf_2", 8);
  });

  it("refuses a value the field's kind does not read, and says why", async () => {
    const onSetField = await openSetField();
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "loud" },
    });
    await apply();
    expect(onSetField).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Must be a number");
  });

  it("clears the field on every row when the value is left empty", async () => {
    const onSetField = await openSetField();
    await apply();
    expect(onSetField).toHaveBeenCalledWith("cf_2", null);
  });

  it("writes a select's option id once another field is picked", async () => {
    const onSetField = await openSetField();
    // A Base UI option takes a press, not a bare click.
    const pick = async (combobox: string, option: string) => {
      await act(async () => {
        fireEvent.click(screen.getByRole("combobox", { name: combobox }));
      });
      await act(async () => {
        const item = screen.getByRole("option", { name: option });
        fireEvent.pointerDown(item);
        fireEvent.click(item);
      });
    };
    await pick("Field", "Mood");
    await pick("Value", "Mellow");
    await apply();
    expect(onSetField).toHaveBeenCalledWith("cf_1", "b2");
  });
});
