import {
  HIGH,
  LEVEL_COLOURS,
  LOW,
  MEDIUM,
  NONE,
  SEEDED_SCALE,
  URGENT,
} from "@/fields/priority-fixture";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { ActionError, PriorityScaleLevel } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

type Written = Omit<PriorityScaleLevel, "counts">;

const createPriorityLevel = mock<
  (
    projectId: number,
    data: { name: string; colour: string }
  ) => Promise<Written | ActionError>
>(async () => HIGH);
const updatePriorityLevel = mock<
  (
    projectId: number,
    levelId: number,
    data: { name?: string; colour?: string; isDefault?: true }
  ) => Promise<Written | ActionError>
>(async () => HIGH);
const reorderPriorityLevels = mock<
  (
    projectId: number,
    ids: number[]
  ) => Promise<PriorityScaleLevel[] | ActionError>
>(async () => SEEDED_SCALE);
const deletePriorityLevel = mock<
  (
    projectId: number,
    levelId: number,
    replaceWith: number
  ) => Promise<{ ok: true } | ActionError>
>(async () => ({ ok: true }));

mock.module("@/actions/priorities", () => ({
  getPriorityLevels: mock(),
  createPriorityLevel,
  updatePriorityLevel,
  reorderPriorityLevels,
  deletePriorityLevel,
}));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { SettingsPriorities } = await import("./SettingsPriorities");

/** High is on three tracks and a session; nothing else holds a level. */
const HELD_HIGH: PriorityScaleLevel = {
  ...HIGH,
  counts: { tracks: 3, collections: 0, sessions: 1 },
};
const SCALE = [NONE, LOW, MEDIUM, HELD_HIGH, URGENT];

const renderScale = async (levels = SCALE, confirmLevelDeletes = true) => {
  await act(async () => {
    render(
      <PoliciesProvider
        policies={{
          ...DEFAULT_POLICIES,
          feedback: {
            ...DEFAULT_POLICIES.feedback,
            confirmDeletes: {
              ...DEFAULT_POLICIES.feedback.confirmDeletes,
              priorityLevel: confirmLevelDeletes,
            },
          },
        }}
      >
        <SettingsPriorities projectId={7} levels={levels} />
      </PoliciesProvider>,
      { wrapper: MotionProvider }
    );
  });
};

const button = (name: string) => screen.getByRole("button", { name });

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(button(name));
  });
};

/** The list item a level's chip sits in. */
const row = (name: string) => {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`no row for ${name}`);
  return item;
};

/** A promise the test settles by hand, to look at the editor mid-write. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

const pick = (name: string) => {
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
};

afterEach(() => {
  cleanup();
  createPriorityLevel.mockClear();
  updatePriorityLevel.mockClear();
  reorderPriorityLevels.mockClear();
  deletePriorityLevel.mockClear();
  refresh.mockClear();
  mayEdit = true;
});

describe("SettingsPriorities", () => {
  it("lists the scale bottom level first and marks the default", async () => {
    await renderScale();

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining("None"),
      expect.stringContaining("Low"),
      expect.stringContaining("Medium"),
      expect.stringContaining("High"),
      expect.stringContaining("Urgent"),
    ]);
    expect(within(row("None")).getByText("Default")).toBeTruthy();
    expect(within(row("High")).queryByText("Default")).toBeNull();
  });

  it("gives an editor Add, and reorder, edit, delete and make-default on each level", async () => {
    await renderScale();

    expect(button("Add priority level")).toBeTruthy();
    expect(button("Move High up")).toBeTruthy();
    expect(button("Move High down")).toBeTruthy();
    expect(button("Edit High")).toBeTruthy();
    expect(button("Delete High")).toBeTruthy();
    expect(button("Make default, High")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make default, None" })
    ).toBeNull();
    expect(document.querySelectorAll("[data-drag-handle]")).toHaveLength(5);
  });

  it("shows a viewer the scale and its default, and nothing to change them with", async () => {
    mayEdit = false;
    await renderScale();

    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(within(row("None")).getByText("Default")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.querySelector("[data-drag-handle]")).toBeNull();
  });

  describe("adding and editing", () => {
    it("adds a level from the form at the top, starting from the top level's colour", async () => {
      await renderScale();

      fireEvent.click(button("Add priority level"));
      expect(
        screen.getByRole("form", { name: "Add priority level" })
      ).toBeTruthy();
      expect(screen.getByLabelText("Hex colour")).toHaveProperty(
        "value",
        URGENT.colour
      );

      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Someday" },
      });
      await click("Save");

      expect(createPriorityLevel).toHaveBeenCalledWith(7, {
        name: "Someday",
        colour: URGENT.colour,
      });
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("renames a level, sending only what changed", async () => {
      await renderScale();

      fireEvent.click(button("Edit High"));
      expect(screen.getByLabelText("Name")).toHaveProperty("value", "High");
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Hot" },
      });
      await click("Save");

      expect(updatePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, {
        name: "Hot",
      });
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("recolours a level", async () => {
      await renderScale();

      fireEvent.click(button("Edit Low"));
      fireEvent.change(screen.getByLabelText("Hex colour"), {
        target: { value: LEVEL_COLOURS.picked },
      });
      await click("Save");

      expect(updatePriorityLevel).toHaveBeenCalledWith(7, LOW.id, {
        colour: LEVEL_COLOURS.picked,
      });
    });

    it("closes without a write when nothing changed", async () => {
      await renderScale();

      fireEvent.click(button("Edit High"));
      await click("Save");

      expect(updatePriorityLevel).not.toHaveBeenCalled();
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("keeps the form open with the error in the row when the name is taken", async () => {
      updatePriorityLevel.mockResolvedValueOnce({
        error: "A priority level with that name already exists",
        status: 409,
      });
      await renderScale();

      fireEvent.click(button("Edit High"));
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Urgent" },
      });
      await click("Save");

      expect(screen.getByRole("alert").textContent).toBe(
        "A priority level with that name already exists"
      );
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe(
        "true"
      );
      expect(screen.getByRole("form", { name: "Edit High" })).toBeTruthy();
    });

    it("refuses a colour that is not a hex colour", async () => {
      await renderScale();

      fireEvent.click(button("Edit High"));
      fireEvent.change(screen.getByLabelText("Hex colour"), {
        target: { value: "red" },
      });
      await click("Save");

      expect(screen.getByRole("alert").textContent).toBe(
        "Use a hex colour with 6 or 8 digits"
      );
      expect(updatePriorityLevel).not.toHaveBeenCalled();
    });
  });

  describe("reordering", () => {
    it("moves a level with its arrows and sends the whole order, bottom first", async () => {
      await renderScale();

      await click("Move High up");

      expect(reorderPriorityLevels).toHaveBeenCalledWith(7, [
        NONE.id,
        LOW.id,
        HIGH.id,
        MEDIUM.id,
        URGENT.id,
      ]);
    });

    it("cannot move the bottom level up or the top level down", async () => {
      await renderScale();

      expect(button("Move None up")).toHaveProperty("disabled", true);
      expect(button("Move Urgent down")).toHaveProperty("disabled", true);
      expect(button("Move None down")).toHaveProperty("disabled", false);
    });

    it("shows the new order at once and holds the arrows until the order call answers", async () => {
      const order = deferred<PriorityScaleLevel[]>();
      reorderPriorityLevels.mockReturnValueOnce(order.promise);
      await renderScale();

      await click("Move Medium down");

      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent)
      ).toEqual([
        expect.stringContaining("None"),
        expect.stringContaining("Low"),
        expect.stringContaining("High"),
        expect.stringContaining("Medium"),
        expect.stringContaining("Urgent"),
      ]);
      expect(button("Move Low down").getAttribute("aria-disabled")).toBe(
        "true"
      );
      await click("Move Low down");
      expect(reorderPriorityLevels).toHaveBeenCalledTimes(1);

      await act(async () => {
        order.settle(SEEDED_SCALE);
      });
      expect(button("Move Low down").getAttribute("aria-disabled")).toBeNull();
    });

    it("puts the list back and reloads the scale when the order call fails", async () => {
      reorderPriorityLevels.mockResolvedValueOnce({
        error: "Failed to reorder priority levels",
        status: 500,
      });
      await renderScale();

      await click("Move Medium down");

      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent)
      ).toEqual([
        expect.stringContaining("None"),
        expect.stringContaining("Low"),
        expect.stringContaining("Medium"),
        expect.stringContaining("High"),
        expect.stringContaining("Urgent"),
      ]);
      expect(button("Move Low down").getAttribute("aria-disabled")).toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("keeps focus on the arrow that moved the level, or its twin at the end of the list", async () => {
      const order = deferred<PriorityScaleLevel[]>();
      reorderPriorityLevels.mockReturnValue(order.promise);
      await renderScale();

      button("Move Medium down").focus();
      await click("Move Medium down");
      expect(document.activeElement).toBe(button("Move Medium down"));

      cleanup();
      await renderScale();
      button("Move High down").focus();
      await click("Move High down");
      expect(document.activeElement).toBe(button("Move High up"));

      reorderPriorityLevels.mockReset();
      reorderPriorityLevels.mockResolvedValue(SEEDED_SCALE);
      await act(async () => {
        order.settle(SEEDED_SCALE);
      });
    });

    it("says where a level moved to, for a screen reader", async () => {
      await renderScale();

      await click("Move High up");

      expect(
        screen.getByText("High moved above Medium").getAttribute("role")
      ).toBe("status");
    });
  });

  describe("the default", () => {
    it("makes a level the default, moving the marker to it at once", async () => {
      const update = deferred<Written>();
      updatePriorityLevel.mockReturnValueOnce(update.promise);
      await renderScale();

      await click("Make default, High");

      expect(updatePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, {
        isDefault: true,
      });
      expect(within(row("High")).getByText("Default")).toBeTruthy();
      expect(within(row("None")).queryByText("Default")).toBeNull();

      await act(async () => {
        update.settle({ ...HIGH, isDefault: true });
      });
    });

    it("does not delete the default, and says what to do instead", async () => {
      await renderScale();

      const bin = button("Delete None");
      expect(bin.getAttribute("aria-disabled")).toBe("true");
      const hint = document.getElementById(
        bin.getAttribute("aria-describedby") ?? ""
      );
      expect(hint?.textContent).toBe("Make another level the default first");

      await act(async () => {
        fireEvent.click(bin);
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(deletePriorityLevel).not.toHaveBeenCalled();
    });
  });

  describe("deleting", () => {
    it("asks where the level's rows go, the default preselected", async () => {
      await renderScale();

      await click("Delete High");

      expect(
        screen.getByText("3 tracks and 1 session use “High”.")
      ).toBeTruthy();
      expect(
        screen.getByRole("combobox", { name: "Move them to" }).textContent
      ).toBe("None");
      expect(deletePriorityLevel).not.toHaveBeenCalled();

      await click("Delete level");

      expect(deletePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, NONE.id);
    });

    it("moves the rows to the level picked instead", async () => {
      await renderScale();

      await click("Delete High");
      await act(async () => {
        fireEvent.click(screen.getByRole("combobox", { name: "Move them to" }));
      });
      expect(screen.queryByRole("option", { name: "High" })).toBeNull();
      await act(async () => {
        pick("Medium");
      });
      await click("Delete level");

      expect(deletePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, MEDIUM.id);
    });

    it("starts again from the default when the same level's delete is reopened", async () => {
      await renderScale();

      await click("Delete High");
      await act(async () => {
        fireEvent.click(screen.getByRole("combobox", { name: "Move them to" }));
      });
      await act(async () => {
        pick("Medium");
      });
      await click("Cancel");
      await click("Delete High");

      expect(
        screen.getByRole("combobox", { name: "Move them to" }).textContent
      ).toBe("None");
    });

    it("reloads the scale when the server refuses the delete", async () => {
      deletePriorityLevel.mockResolvedValueOnce({
        error: "Replacement level not found in this project",
        status: 400,
      });
      await renderScale();

      await click("Delete High");
      await click("Delete level");

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("names the only other level as where the rows go, with nothing to pick", async () => {
      await renderScale([NONE, HELD_HIGH]);

      await click("Delete High");

      expect(screen.queryByRole("combobox")).toBeNull();
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText("Move them to")).toBeTruthy();
      expect(within(dialog).getByText("None")).toBeTruthy();

      await click("Delete level");

      expect(deletePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, NONE.id);
    });

    it("deletes a level nothing uses without asking where its rows go", async () => {
      await renderScale();

      await click("Delete Low");

      expect(
        screen.getByText("No tracks, collections or sessions use “Low”.")
      ).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();

      await click("Delete level");

      expect(deletePriorityLevel).toHaveBeenCalledWith(7, LOW.id, NONE.id);
    });

    it("keeps a level nothing uses when the confirm is cancelled", async () => {
      await renderScale();

      await click("Delete Low");
      await click("Cancel");

      expect(deletePriorityLevel).not.toHaveBeenCalled();
    });

    it("deletes a level nothing uses straight away when priority level confirms are off", async () => {
      await renderScale(SCALE, false);

      await click("Delete Low");

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(deletePriorityLevel).toHaveBeenCalledWith(7, LOW.id, NONE.id);
    });

    it("still asks where a held level's rows go when priority level confirms are off", async () => {
      await renderScale(SCALE, false);

      await click("Delete High");

      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText("Move them to")).toBeTruthy();
      expect(deletePriorityLevel).not.toHaveBeenCalled();

      await click("Delete level");

      expect(deletePriorityLevel).toHaveBeenCalledWith(7, HIGH.id, NONE.id);
    });
  });
});
