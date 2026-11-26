import { describe, expect, test } from "bun:test";

import {
  createBackfillKeymap,
  type BackfillCommand,
  type BackfillKeyScope,
} from "./keys";

const ALL: BackfillKeyScope = {
  choose: () => true,
  primary: () => true,
  back: () => true,
  close: () => true,
};

function recording(scope: BackfillKeyScope): {
  ran: BackfillCommand[];
  press: (init: KeyboardEventInit, target?: EventTarget) => void;
} {
  const ran: BackfillCommand[] = [];
  const keymap = createBackfillKeymap(scope, (command) => ran.push(command));
  const field = document.createElement("input");
  return {
    ran,
    press: (init, target = field) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      Object.defineProperty(event, "target", { value: target });
      keymap.dispatch(event);
    },
  };
}

describe("the backfill window's keys", () => {
  test("⌘O chooses folders, ⌘↩ is the primary action, ⌘[ goes back and Esc closes, from inside a field", () => {
    const { ran, press } = recording(ALL);

    press({ key: "o", metaKey: true });
    press({ key: "Enter", metaKey: true });
    press({ key: "[", metaKey: true });
    press({ key: "Escape" });

    expect(ran).toEqual(["choose", "primary", "back", "close"]);
  });

  test("a key the step does not use is as if unbound", () => {
    const { ran, press } = recording({
      ...ALL,
      choose: () => false,
      back: () => false,
      close: () => false,
    });

    press({ key: "o", metaKey: true });
    press({ key: "[", metaKey: true });
    press({ key: "Escape" });
    press({ key: "Enter", metaKey: true });

    expect(ran).toEqual(["primary"]);
  });

  test("a bare ↩ is not the window's: it belongs to the control that has focus", () => {
    const { ran, press } = recording(ALL);
    const button = document.createElement("button");

    press({ key: "Enter" });
    press({ key: "Enter" }, button);
    press({ key: " " }, button);

    expect(ran).toEqual([]);
  });
});
