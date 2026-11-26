import { describe, expect, it } from "bun:test";
import { clientKeyOverrides } from "@/components/commands/key-overrides";

describe("clientKeyOverrides", () => {
  it("drops an empty override for a reserved command", () => {
    expect(clientKeyOverrides({ "keyboard-shortcuts": [] })).toEqual({});
    expect(clientKeyOverrides({ "command-palette": [] })).toEqual({});
  });

  it("keeps an empty override for a command that may go keyless", () => {
    expect(clientKeyOverrides({ "toggle-sidebar": [] })).toEqual({
      "toggle-sidebar": [],
    });
  });

  it("keeps a non-empty override for a reserved command", () => {
    expect(clientKeyOverrides({ "command-palette": ["mod+j"] })).toEqual({
      "command-palette": ["mod+j"],
    });
  });

  it("gives the linked close command the keys of the command it follows", () => {
    expect(clientKeyOverrides({ "keyboard-shortcuts": ["f1"] })).toEqual({
      "keyboard-shortcuts": ["f1"],
      "close-keyboard-shortcuts": ["f1"],
    });
  });

  it("ignores the follower's own stored entry", () => {
    expect(clientKeyOverrides({ "close-keyboard-shortcuts": ["x"] })).toEqual(
      {}
    );
    expect(
      clientKeyOverrides({
        "keyboard-shortcuts": ["f1"],
        "close-keyboard-shortcuts": ["x"],
      })
    ).toEqual({
      "keyboard-shortcuts": ["f1"],
      "close-keyboard-shortcuts": ["f1"],
    });
  });

  it("does not link the follower when the target's empty override was dropped", () => {
    expect(
      clientKeyOverrides({
        "keyboard-shortcuts": [],
        "close-keyboard-shortcuts": ["x"],
      })
    ).toEqual({});
  });

  it("passes an unknown id through", () => {
    expect(clientKeyOverrides({ nonsense: ["q"] })).toEqual({
      nonsense: ["q"],
    });
  });
});
