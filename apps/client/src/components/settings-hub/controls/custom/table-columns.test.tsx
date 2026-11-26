import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const useHub = mock(() => ({ projectId: 1 }));
mock.module("../../hub-rows", () => ({ useHub }));

const useParts = mock(() => ({
  columns: [
    { id: "title", header: "Title" },
    { id: "actions", header: "", enableHiding: false },
    { id: "isrc", header: "ISRC" },
    { id: "bpm", header: "BPM", meta: { group: "Fields" } },
  ],
  initiallyHiddenColumns: ["isrc"],
}));
mock.module("@/entities/tables", () => ({
  entityTable: () => ({ useParts }),
}));

const { SETTINGS } = await import("@workspace/settings");
const { TableColumnsControl } = await import("./table-columns");

const DEFINITION = SETTINGS["tables.trackColumns"] as never;

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <TableColumnsControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="track-columns"
    />
  );
  return onChange;
}

afterEach(cleanup);

describe("TableColumnsControl", () => {
  it("shows every hideable column, a missing entry as the table shows it", () => {
    mount({ bpm: false });

    expect(
      screen.getByRole("switch", { name: "Title" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("switch", { name: "ISRC" }).getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen.getByRole("switch", { name: "BPM" }).getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.queryByRole("switch", { name: "" })).toBeNull();
  });

  it("a toggle writes only the columns that differ from the table's default", () => {
    const onChange = mount({ bpm: false });

    fireEvent.click(screen.getByRole("switch", { name: "Title" }));

    expect(onChange).toHaveBeenCalledWith({ title: false, bpm: false });
  });

  it("showing a hidden-by-default column writes it as shown", () => {
    const onChange = mount({});

    fireEvent.click(screen.getByRole("switch", { name: "ISRC" }));

    expect(onChange).toHaveBeenCalledWith({ isrc: true });
  });
});
