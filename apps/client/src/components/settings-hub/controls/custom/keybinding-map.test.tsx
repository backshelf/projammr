import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { settings } from "@workspace/settings/groups/keybindings";
import { COMMANDS } from "@/components/commands/index";
import { KeybindingMapControl } from "./keybinding-map";
import type { ControlOf, SettingControlProps } from "../types";

afterEach(cleanup);

type Props = SettingControlProps<unknown, ControlOf<"custom">>;

const definitionOf = (key: string) =>
  settings.find((each) => each.key === key) as unknown as Props["definition"];

const labelOf = (id: string) => {
  const command = COMMANDS.find((each) => each.id === id);
  if (!command) throw new Error(`No client command ${id}`);
  return command.label;
};

function mount(value: unknown, disabled = false, key = "keybindings.client") {
  const onChange = mock<(value: unknown) => void>();
  render(
    <KeybindingMapControl
      definition={definitionOf(key)}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="fixture-keybinding-map"
    />
  );
  return onChange;
}

function capture(id: string, key: string, init: object = {}) {
  fireEvent.click(
    screen.getByRole("button", { name: `Change keys for ${labelOf(id)}` })
  );
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: `Press the new keys for ${labelOf(id)}`,
    }),
    { key, ...init }
  );
}

describe("KeybindingMapControl (app shortcuts)", () => {
  it("lists a command with no keys and one with keys, under their groups", () => {
    mount({});

    const lab = screen.getByRole("region", { name: "Lab" });
    expect(within(lab).getByText(labelOf("open-lab"))).toBeTruthy();
    expect(within(lab).getByText("Unbound")).toBeTruthy();
    expect(screen.getByText(labelOf("toggle-lab"))).toBeTruthy();
  });

  it("does not list a command that follows another's keys", () => {
    mount({});

    expect(screen.queryByText(labelOf("close-keyboard-shortcuts"))).toBeNull();
  });

  it("writes the captured combo as the command's only keys", () => {
    const onChange = mount({});

    capture("toggle-lab", "F9");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ "toggle-lab": ["F9"] });
  });

  it("returns focus to Change once the capture is done", () => {
    mount({});

    capture("toggle-lab", "F9");

    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: `Change keys for ${labelOf("toggle-lab")}`,
      })
    );
  });

  it("adds a key to a command that had none", () => {
    const onChange = mount({});

    capture("open-lab", "F9");

    expect(onChange).toHaveBeenCalledWith({ "open-lab": ["F9"] });
  });

  it("refuses a capture another command already owns, with no write", () => {
    const onChange = mount({});

    capture("toggle-lab", "k", { ctrlKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      `already runs ${labelOf("command-palette")}.`
    );
    expect(
      screen.getByRole("button", {
        name: `Press the new keys for ${labelOf("toggle-lab")}`,
      })
    ).toBeTruthy();
  });

  it("takes a different key after a refusal", () => {
    const onChange = mount({});

    capture("toggle-lab", "k", { ctrlKey: true });
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: `Press the new keys for ${labelOf("toggle-lab")}`,
      }),
      { key: "F9" }
    );

    expect(onChange).toHaveBeenCalledWith({ "toggle-lab": ["F9"] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the record alone when the capture is cancelled", () => {
    const onChange = mount({});

    capture("toggle-lab", "Escape");

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: `Change keys for ${labelOf("toggle-lab")}`,
      })
    ).toBeTruthy();
  });

  it("drops an override that equals the defaults", () => {
    const onChange = mount({ "keyboard-shortcuts": ["F9"] });

    capture("keyboard-shortcuts", "?");

    expect(onChange).toHaveBeenCalledWith({});
  });

  it("removes a command's keys by writing an empty list", () => {
    const onChange = mount({});

    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove keys for ${labelOf("toggle-lab")}`,
      })
    );

    expect(onChange).toHaveBeenCalledWith({ "toggle-lab": [] });
  });

  it("refuses to remove the keys of a reserved command, with no write", () => {
    const onChange = mount({});

    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove keys for ${labelOf("keyboard-shortcuts")}`,
      })
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "This command must keep a key."
    );
  });

  it("shows the defaults beside an override and resets it on its own", () => {
    const onChange = mount({ "toggle-lab": ["F9"], "open-lab": ["F8"] });

    const row = screen.getByText(labelOf("toggle-lab")).closest("li");
    expect(row?.textContent).toContain("Default:");
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: `Reset keys for ${labelOf("toggle-lab")}`,
      })
    );

    expect(onChange).toHaveBeenCalledWith({ "open-lab": ["F8"] });
  });

  it("offers no reset on a command at its defaults", () => {
    mount({ "toggle-lab": ["F9"] });

    expect(
      screen.queryByRole("button", {
        name: `Reset keys for ${labelOf("toggle-mono")}`,
      })
    ).toBeNull();
  });

  it("resets everything to `{}` only after the confirm", () => {
    const onChange = mount({ "toggle-lab": ["F9"] });

    fireEvent.click(
      screen.getByRole("button", { name: "Reset all to defaults" })
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it("offers no reset all while nothing is changed", () => {
    mount({});

    expect(
      screen.queryByRole("button", { name: "Reset all to defaults" })
    ).toBeNull();
  });

  it("lists a stored id no command has, and removes it", () => {
    const onChange = mount({ gone: ["x"], "toggle-lab": ["F9"] });

    const section = screen.getByRole("region", { name: "Unknown commands" });
    expect(within(section).getByText("gone")).toBeTruthy();
    fireEvent.click(
      within(section).getByRole("button", { name: "Remove gone" })
    );

    expect(onChange).toHaveBeenCalledWith({ "toggle-lab": ["F9"] });
  });

  it("notes a clash already in the stored value on both rows, without blocking edits", () => {
    const onChange = mount({ "toggle-lab": ["u"] });

    const notes = screen.getAllByRole("status");
    expect(notes.map((each) => each.textContent)).toEqual([
      `U already runs ${labelOf("toggle-lab")}.`,
      `U already runs ${labelOf("undo")}.`,
    ]);
    capture("toggle-mono", "F9");

    expect(onChange).toHaveBeenCalledWith({
      "toggle-lab": ["u"],
      "toggle-mono": ["F9"],
    });
  });

  it("renders the map with no actions while disabled", () => {
    mount({ "toggle-lab": ["F9"], gone: ["x"] }, true);

    expect(screen.getByText(labelOf("toggle-lab"))).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
