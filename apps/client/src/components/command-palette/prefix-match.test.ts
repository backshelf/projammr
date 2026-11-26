import { describe, expect, it } from "bun:test";
import { matchPrefixCommand } from "./prefix-match";

const COMMANDS = [
  { id: "play", prefix: "play " },
  { id: "go", prefix: "go " },
];

describe("matchPrefixCommand", () => {
  it("matches a completed prefix and returns the remainder", () => {
    const match = matchPrefixCommand(COMMANDS, "play low tide");
    expect(match?.command.id).toBe("play");
    expect(match?.remainder).toBe("low tide");
  });

  it("is case-insensitive on the prefix", () => {
    expect(matchPrefixCommand(COMMANDS, "PLAY Low Tide")?.remainder).toBe(
      "Low Tide"
    );
  });

  it("preserves the remainder's own casing", () => {
    expect(matchPrefixCommand(COMMANDS, "play Low Tide")?.remainder).toBe(
      "Low Tide"
    );
  });

  it("trims the remainder", () => {
    expect(matchPrefixCommand(COMMANDS, "play   low tide  ")?.remainder).toBe(
      "low tide"
    );
  });

  it("matches the prefix with an empty remainder", () => {
    const match = matchPrefixCommand(COMMANDS, "play ");
    expect(match?.command.id).toBe("play");
    expect(match?.remainder).toBe("");
  });

  it("does not match a partially typed prefix", () => {
    expect(matchPrefixCommand(COMMANDS, "pla")).toBeNull();
    expect(matchPrefixCommand(COMMANDS, "play")).toBeNull();
  });

  it("does not match a prefix appearing later in the query", () => {
    expect(matchPrefixCommand(COMMANDS, "songs to play now")).toBeNull();
  });

  it("returns null for a query matching no registered prefix", () => {
    expect(matchPrefixCommand(COMMANDS, "low tide")).toBeNull();
    expect(matchPrefixCommand(COMMANDS, "")).toBeNull();
  });

  it("picks the first registered command when prefixes overlap", () => {
    const overlapping = [
      { id: "p", prefix: "p " },
      { id: "play", prefix: "play " },
    ];
    expect(matchPrefixCommand(overlapping, "p low")?.command.id).toBe("p");
  });
});

describe("matchPrefixCommand with aliases", () => {
  it("opens a command from an alias typed in full, with its remainder", () => {
    const match = matchPrefixCommand(COMMANDS, "P low tide", { p: "play" });
    expect(match?.command.id).toBe("play");
    expect(match?.remainder).toBe("low tide");
  });

  it("does not open the command while the alias is still being typed", () => {
    expect(matchPrefixCommand(COMMANDS, "pl", { pl: "play" })).toBeNull();
    expect(matchPrefixCommand(COMMANDS, "plx low", { pl: "play" })).toBeNull();
  });

  it("keeps a command's own prefix ahead of an alias for another", () => {
    expect(
      matchPrefixCommand(COMMANDS, "go home", { go: "play" })?.command.id
    ).toBe("go");
  });

  it("passes over an alias for a command that does not exist, or a blank one", () => {
    expect(matchPrefixCommand(COMMANDS, "x low", { x: "gone" })).toBeNull();
    expect(matchPrefixCommand(COMMANDS, " low", { " ": "play" })).toBeNull();
  });
});
