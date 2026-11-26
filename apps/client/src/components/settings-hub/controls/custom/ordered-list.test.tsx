import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { shellFrom } from "@/lib/policies/from-settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/effective";
import { defineSetting, SETTINGS } from "@workspace/settings";
import { OrderedListControl } from "./ordered-list";
import type { ControlOf, SettingControlProps } from "../types";

afterEach(cleanup);

const OPTIONS = [
  { value: "collections", label: "Collections" },
  { value: "tracks", label: "Tracks" },
  { value: "notebook", label: "Notebook" },
] as const;

const definition = defineSetting({
  key: "fixture.orderedList",
  group: "fixture",
  label: "Sidebar sections",
  description: "Which sections the sidebar shows, in what order.",
  keywords: [],
  scopes: ["user"],
  schema: z.array(
    z.object({ id: z.string(), shown: z.boolean() }).catchall(z.unknown())
  ),
  default: OPTIONS.map((option) => ({ id: option.value, shown: true })),
  control: { kind: "custom", component: "ordered-list", options: OPTIONS },
  audience: "all",
});

type Props = SettingControlProps<unknown, ControlOf<"custom">>;
const DEFINITION = definition as unknown as Props["definition"];

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <OrderedListControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="fixture-ordered-list"
    />
  );
  return onChange;
}

describe("OrderedListControl", () => {
  it("renders the default in order", () => {
    mount(definition.default);

    const rows = screen.getAllByText(/Collections|Tracks|Notebook/);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Collections",
      "Tracks",
      "Notebook",
    ]);
  });

  it("moving a row writes the swapped list", () => {
    const onChange = mount(definition.default);

    fireEvent.click(screen.getByRole("button", { name: "Move Tracks up" }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "tracks", shown: true },
      { id: "collections", shown: true },
      { id: "notebook", shown: true },
    ]);
  });

  it("toggling writes shown: false and keeps collapsed: true on a row that had it", () => {
    const onChange = mount([
      { id: "collections", shown: true, collapsed: true },
      { id: "tracks", shown: true },
      { id: "notebook", shown: true },
    ]);

    fireEvent.click(screen.getByRole("switch", { name: "Show Collections" }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "collections", shown: false, collapsed: true },
      { id: "tracks", shown: true },
      { id: "notebook", shown: true },
    ]);
  });

  it("drops a stored unknown id and appends a missing option", () => {
    const onChange = mount([
      { id: "collections", shown: true },
      { id: "gone", shown: false },
    ]);

    expect(screen.queryByText("gone")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Show Collections" }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "collections", shown: false },
      { id: "tracks", shown: true },
      { id: "notebook", shown: true },
    ]);
  });

  it("shows the same rows as the shell mapping for a partial sidebar list, and a write of them parses", () => {
    const setting = SETTINGS["layout.sidebarSections"];
    const partial = [{ id: "tracks" as const, shown: false, collapsed: true }];
    const onChange = mock<(value: unknown) => void>();
    render(
      <OrderedListControl
        definition={setting as unknown as Props["definition"]}
        value={partial}
        onChange={onChange}
        disabled={false}
        id="sidebar-sections"
      />
    );

    const { sidebarSections } = shellFrom({
      ...DEFAULT_SETTINGS,
      "layout.sidebarSections": partial,
    });
    const labels = Object.fromEntries(
      (setting.control as ControlOf<"custom">).options?.map((option) => [
        option.value,
        option.label,
      ]) ?? []
    );
    expect(
      screen.getAllByRole("switch").map((row) => row.getAttribute("aria-label"))
    ).toEqual(sidebarSections.map(({ id }) => `Show ${labels[id]}`));

    fireEvent.click(screen.getByRole("switch", { name: "Show Collections" }));

    const written = onChange.mock.calls[0]![0];
    expect(setting.schema.safeParse(written).success).toBe(true);
    expect(written).toEqual(
      sidebarSections.map((row) =>
        row.id === "collections" ? { ...row, shown: false } : row
      )
    );
  });

  it("disables the up button on the first row and the down button on the last", () => {
    mount(definition.default);

    const up = screen.getByRole("button", {
      name: "Move Collections up",
    }) as HTMLButtonElement;
    const down = screen.getByRole("button", {
      name: "Move Notebook down",
    }) as HTMLButtonElement;

    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });
});
