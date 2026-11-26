import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  PALETTE_PREFIX_COMMANDS,
  settings,
} from "@workspace/settings/groups/palette";
import { PaletteAliasesControl } from "./palette-aliases";
import type { ControlOf, SettingControlProps } from "../types";

afterEach(cleanup);

type Props = SettingControlProps<unknown, ControlOf<"custom">>;
const DEFINITION = settings.find(
  (each) => each.key === "palette.aliases"
) as unknown as Props["definition"];

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <PaletteAliasesControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="fixture-palette-aliases"
    />
  );
  return onChange;
}

describe("PaletteAliasesControl", () => {
  it("offers the palette's prefix commands as a select, not free text", () => {
    mount({});

    const trigger = screen.getByLabelText("New command");
    expect(trigger.tagName).not.toBe("INPUT");
    fireEvent.click(trigger);

    const labels = screen
      .getAllByRole("option")
      .map((each) => each.textContent);
    expect(labels).toHaveLength(PALETTE_PREFIX_COMMANDS.length);
    expect(labels).toContain("play");
    expect(labels).toContain("new track titled");
  });

  it("refuses an alias with no command chosen, with no write", () => {
    const onChange = mount({});

    fireEvent.change(screen.getByLabelText("New alias"), {
      target: { value: "s" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "That isn't a command this palette knows."
    );
  });

  it("refuses a duplicate alias with no write", () => {
    const onChange = mount({ t: "theme" });

    fireEvent.change(screen.getByLabelText("New alias"), {
      target: { value: "t" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "That alias is already taken."
    );
  });

  it("remove writes without it", () => {
    const onChange = mount({ t: "theme", s: "status" });

    fireEvent.click(screen.getByRole("button", { name: "Remove t" }));

    expect(onChange).toHaveBeenCalledWith({ s: "status" });
  });
});
