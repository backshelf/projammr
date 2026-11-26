import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const useHub = mock(() => ({ projectId: 1 }));
mock.module("../../hub-rows", () => ({ useHub }));

const useParts = mock(() => ({
  groupByOptions: [
    { id: "status", label: "Status" },
    { id: "priority", label: "Priority" },
  ],
}));
mock.module("@/entities/tables", () => ({
  entityTable: () => ({ useParts }),
}));

const { SETTINGS } = await import("@workspace/settings");
const { TableGroupingControl } = await import("./table-grouping");

const DEFINITION = SETTINGS["tables.trackGrouping"] as never;

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <TableGroupingControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="track-grouping"
    />
  );
  return onChange;
}

async function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
}

afterEach(cleanup);

describe("TableGroupingControl", () => {
  it("shows None with an empty value", () => {
    mount("");

    expect(screen.getByRole("button", { name: "Group by" })).toBeTruthy();
  });

  it("shows the active grouping", () => {
    mount("status");

    expect(screen.getByText("Grouped by Status")).toBeTruthy();
  });

  it("picking an option writes its id", async () => {
    const onChange = mount("");
    await openMenu("Group by");

    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Status" })
    );

    expect(onChange).toHaveBeenCalledWith("status");
  });

  it("choosing None while one is active clears it", async () => {
    const onChange = mount("status");
    await openMenu(/Grouped by Status/);

    fireEvent.click(await screen.findByRole("menuitem", { name: "None" }));

    expect(onChange).toHaveBeenCalledWith("");
  });
});
