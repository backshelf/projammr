import { describe, expect, it } from "bun:test";
import { COMMANDS } from "@/components/commands/index";
import { LINKED_CLIENT_COMMANDS } from "@workspace/settings/groups/keybindings";
import {
  CLIENT_KEY_COMMANDS,
  keyCommandsFor,
  withKeys,
  withoutOverride,
} from "./keybinding-commands";
import { conflicts } from "./keybinding-rules";

const client = (id: string) => {
  const command = CLIENT_KEY_COMMANDS.find((each) => each.id === id);
  if (!command) throw new Error(`No client command ${id}`);
  return command;
};

describe("CLIENT_KEY_COMMANDS", () => {
  it("lists every command but the linked ones, keyless ones included", () => {
    const linked = Object.keys(LINKED_CLIENT_COMMANDS);

    expect(CLIENT_KEY_COMMANDS).toHaveLength(COMMANDS.length - linked.length);
    for (const id of linked) {
      expect(CLIENT_KEY_COMMANDS.some((each) => each.id === id)).toBe(false);
    }
    expect(client("open-lab").defaults).toEqual([]);
  });

  it("carries each command's scope, keys and group", () => {
    expect(client("toggle-lab")).toMatchObject({
      scope: "global",
      defaults: ["l"],
      group: "Lab",
    });
  });

  it("marks the reserved commands and only those", () => {
    expect(
      CLIENT_KEY_COMMANDS.filter((each) => each.reserved).map((each) => each.id)
    ).toEqual(["command-palette", "keyboard-shortcuts"]);
  });

  it("lets a command that yields to a count take a digit, and no other", () => {
    expect(client("seek-to-3").digits).toBe(true);
    expect(client("toggle-lab").digits).toBe(false);
  });

  it("starts with no clash among the defaults", () => {
    expect(conflicts(CLIENT_KEY_COMMANDS, {})).toEqual([]);
  });
});

describe("keyCommandsFor", () => {
  it("picks the map by setting key", () => {
    expect(keyCommandsFor("keybindings.client")).toBe(CLIENT_KEY_COMMANDS);
  });

  it("throws for a setting that has no map", () => {
    expect(() => keyCommandsFor("keybindings.other")).toThrow(
      "No keybinding map for setting: keybindings.other"
    );
    expect(() => keyCommandsFor("toString")).toThrow();
  });
});

describe("withKeys", () => {
  const lab = client("toggle-lab");

  it("sets the command's keys", () => {
    expect(withKeys({ other: ["F1"] }, lab, ["F9"])).toEqual({
      other: ["F1"],
      "toggle-lab": ["F9"],
    });
  });

  it("drops the entry when the keys equal the defaults as a set", () => {
    expect(withKeys({ "toggle-lab": ["F9"] }, lab, ["l"])).toEqual({});
  });

  it("keeps an empty list for a command that has defaults", () => {
    expect(withKeys({}, lab, [])).toEqual({ "toggle-lab": [] });
  });

  it("drops an empty list for a command that has none", () => {
    expect(withKeys({ "open-lab": ["F9"] }, client("open-lab"), [])).toEqual(
      {}
    );
  });

  it("does not change the record it was given", () => {
    const overrides = { other: ["F1"] };
    withKeys(overrides, lab, ["F9"]);
    expect(overrides).toEqual({ other: ["F1"] });
  });
});

describe("withoutOverride", () => {
  it("removes one id and keeps the rest", () => {
    expect(withoutOverride({ a: ["x"], b: ["y"] }, "a")).toEqual({ b: ["y"] });
  });
});
