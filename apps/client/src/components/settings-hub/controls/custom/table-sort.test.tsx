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
  columns: [
    { id: "title", header: "Title" },
    { id: "bpm", header: "BPM" },
    { id: "labels", header: "Labels", enableSorting: false },
  ],
}));
mock.module("@/entities/tables", () => ({
  entityTable: () => ({ useParts }),
}));

const { SETTINGS } = await import("@workspace/settings");
const { TableSortControl } = await import("./table-sort");

const DEFINITION = SETTINGS["tables.trackSort"] as never;

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <TableSortControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="track-sort"
    />
  );
  return onChange;
}

// Base UI's menu trigger opens on pointerdown, which happy-dom's synthetic
// pointer event does not carry, so open it with a key instead (as
// BulkActionsBar.test.tsx does).
async function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
}

afterEach(cleanup);

describe("TableSortControl", () => {
  it("shows None with an empty value, and no direction toggle", () => {
    mount("");

    expect(screen.getByRole("button", { name: "None" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ascending" })).toBeNull();
  });

  it("shows the sorted column and its direction", () => {
    mount("bpm.desc");

    expect(screen.getByText("Sorted by BPM")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Descending" })).toBeTruthy();
  });

  it("picking a column writes it ascending by default", async () => {
    const onChange = mount("");
    await openMenu("None");

    fireEvent.click(await screen.findByRole("menuitem", { name: "BPM" }));

    expect(onChange).toHaveBeenCalledWith("bpm.asc");
  });

  it("offers no column the table cannot sort by", async () => {
    mount("");
    await openMenu("None");

    expect(await screen.findByRole("menuitem", { name: "BPM" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Labels" })).toBeNull();
  });

  it("the direction toggle flips asc to desc, keeping the column", () => {
    const onChange = mount("bpm.asc");

    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));

    expect(onChange).toHaveBeenCalledWith("bpm.desc");
  });
});
