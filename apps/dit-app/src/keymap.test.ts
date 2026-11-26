import { describe, expect, test } from "bun:test";

import { createPanelKeymap, PANEL_BINDINGS, type PanelCommand } from "./keymap";

function keymapRecording(): {
  ran: PanelCommand[];
  dispatch: (init: KeyboardEventInit) => void;
} {
  const ran: PanelCommand[] = [];
  const keymap = createPanelKeymap((command) => ran.push(command));
  const field = document.createElement("textarea");
  return {
    ran,
    dispatch: (init) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      Object.defineProperty(event, "target", { value: field });
      keymap.dispatch(event);
    },
  };
}

describe("the panel's keys", () => {
  test("are commit, close and settings, each answering while a field has focus", () => {
    expect(
      PANEL_BINDINGS.map(({ id, keys, allowInInput }) => ({
        id,
        keys,
        allowInInput,
      }))
    ).toEqual([
      { id: "commit", keys: ["mod+Enter"], allowInInput: true },
      { id: "back", keys: ["Escape"], allowInInput: true },
      { id: "settings", keys: ["mod+,"], allowInInput: true },
    ]);
  });

  test("⌘↩ commits, Esc backs out and ⌘, opens settings, from inside a text field", () => {
    const { ran, dispatch } = keymapRecording();

    dispatch({ key: "Enter", metaKey: true });
    dispatch({ key: "Escape" });
    dispatch({ key: ",", metaKey: true });

    expect(ran).toEqual(["commit", "back", "settings"]);
  });

  test("a bare Enter or a bare comma runs nothing", () => {
    const { ran, dispatch } = keymapRecording();

    dispatch({ key: "Enter" });
    dispatch({ key: "," });

    expect(ran).toEqual([]);
  });
});
