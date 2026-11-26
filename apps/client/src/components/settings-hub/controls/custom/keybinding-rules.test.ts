import { describe, expect, it } from "bun:test";
import { COMMANDS } from "@/components/commands/index";
import { GLOBAL_SCOPE } from "@workspace/ui/lib/keymap";
import {
  checkBinding,
  conflicts,
  effectiveKeys,
  refusalText,
  unknownOverrideIds,
  type BindableCommand,
} from "./keybinding-rules";

const command = (
  id: string,
  defaults: string[],
  extra: Partial<BindableCommand> = {}
): BindableCommand => ({
  id,
  label: `Label ${id}`,
  scope: GLOBAL_SCOPE,
  defaults,
  ...extra,
});

const commands: BindableCommand[] = [
  command("a", ["x"]),
  command("b", ["y"]),
  command("go-project", ["g p"]),
  command("tab", ["j"], { scope: "table" }),
  command("seek", ["1"], { digits: true }),
  command("help", ["?"], { reserved: true }),
  command("tenth", ["0"], { fixed: true, digits: true }),
];

describe("effectiveKeys", () => {
  it("returns the defaults without an override and the override with one", () => {
    expect(effectiveKeys(commands[0]!, {})).toEqual(["x"]);
    expect(effectiveKeys(commands[0]!, { a: ["z"] })).toEqual(["z"]);
    expect(effectiveKeys(commands[0]!, { a: [] })).toEqual([]);
  });
});

describe("unknownOverrideIds", () => {
  it("lists override ids that name no command", () => {
    expect(unknownOverrideIds(commands, { a: ["z"], gone: ["q"] })).toEqual([
      "gone",
    ]);
    expect(unknownOverrideIds(commands, {})).toEqual([]);
  });
});

describe("checkBinding", () => {
  it("allows a free key, and the command's own current key", () => {
    expect(checkBinding(commands, {}, "a", ["z"])).toBeNull();
    expect(checkBinding(commands, {}, "a", ["x"])).toBeNull();
  });

  it("refuses a combo another command in the same scope runs as taken", () => {
    expect(checkBinding(commands, {}, "a", ["y"])).toEqual({
      kind: "taken",
      combo: "y",
      other: { id: "b", label: "Label b" },
    });
  });

  it("allows the same combo in a different scope", () => {
    expect(checkBinding(commands, {}, "a", ["j"])).toBeNull();
    expect(checkBinding(commands, {}, "tab", ["x"])).toBeNull();
  });

  it("compares against effective keys: moving A off x frees x for B", () => {
    expect(checkBinding(commands, {}, "b", ["x"])?.kind).toBe("taken");
    expect(checkBinding(commands, { a: ["z"] }, "b", ["x"])).toBeNull();
    expect(checkBinding(commands, { a: ["z"] }, "b", ["z"])?.kind).toBe(
      "taken"
    );
  });

  it("refuses a bare letter that opens another command's chord", () => {
    expect(checkBinding(commands, {}, "a", ["g"])).toEqual({
      kind: "opens-chord",
      combo: "g",
      other: { id: "go-project", label: "Label go-project" },
      chord: "g p",
    });
  });

  it("refuses a chord behind another command's single key", () => {
    expect(checkBinding(commands, {}, "go-project", ["x q"])).toEqual({
      kind: "behind-single",
      combo: "x q",
      other: { id: "a", label: "Label a" },
    });
  });

  it("allows a chord on its own opener, and a chord sharing an opener with another chord", () => {
    expect(checkBinding(commands, {}, "a", ["g c"])).toBeNull();
    expect(checkBinding(commands, {}, "go-project", ["g c"])).toBeNull();
  });

  it("refuses a digit unless the command takes digits", () => {
    expect(checkBinding(commands, {}, "a", ["5"])).toEqual({
      kind: "digit",
      combo: "5",
    });
    expect(checkBinding(commands, {}, "seek", ["5"])).toBeNull();
    expect(checkBinding(commands, {}, "a", ["mod+5"])).toBeNull();
  });

  it("refuses a key that types for a command that runs while typing", () => {
    const typing = [
      command("send", ["mod+Enter"], { scope: "compose", typing: true }),
    ];
    for (const combo of ["y", "shift+y", "space", "g t", "?"]) {
      expect(checkBinding(typing, {}, "send", [combo])).toEqual({
        kind: "types",
        combo,
      });
    }
    for (const combo of ["Enter", "mod+y", "alt+y", "mod+shift+y"]) {
      expect(checkBinding(typing, {}, "send", [combo])).toBeNull();
    }
    expect(checkBinding(commands, {}, "a", ["z"])).toBeNull();
  });

  it("refuses no keys on a reserved command, and allows it elsewhere", () => {
    expect(checkBinding(commands, {}, "help", [])).toEqual({
      kind: "must-keep-key",
    });
    expect(checkBinding(commands, {}, "a", [])).toBeNull();
  });

  it("refuses any change to a fixed command, but not keeping its keys", () => {
    expect(checkBinding(commands, {}, "tenth", ["z"])).toEqual({
      kind: "fixed",
    });
    expect(checkBinding(commands, {}, "tenth", [])).toEqual({ kind: "fixed" });
    expect(checkBinding(commands, {}, "tenth", ["0"])).toBeNull();
  });

  it("refuses a combo that is not canonical", () => {
    expect(checkBinding(commands, {}, "a", ["shift+mod+z"])).toEqual({
      kind: "invalid",
      combo: "shift+mod+z",
    });
    expect(checkBinding(commands, {}, "a", ["nonsense key"])?.kind).toBe(
      "invalid"
    );
  });

  it("treats duplicates inside keys as one", () => {
    expect(checkBinding(commands, {}, "a", ["z", "z"])).toBeNull();
  });

  it("throws for an id the list does not hold", () => {
    expect(() => checkBinding(commands, {}, "nope", ["z"])).toThrow();
  });
});

describe("conflicts", () => {
  it("is empty for a clean map", () => {
    expect(conflicts(commands, {})).toEqual([]);
  });

  it("lists a clash against each command involved", () => {
    expect(conflicts(commands, { a: ["y"] })).toEqual([
      {
        id: "a",
        refusal: {
          kind: "taken",
          combo: "y",
          other: { id: "b", label: "Label b" },
        },
      },
      {
        id: "b",
        refusal: {
          kind: "taken",
          combo: "y",
          other: { id: "a", label: "Label a" },
        },
      },
    ]);
  });

  it("reports an unbound reserved command and a stored digit", () => {
    const found = conflicts(commands, { help: [], a: ["7"] });
    expect(found).toEqual([
      { id: "a", refusal: { kind: "digit", combo: "7" } },
      { id: "help", refusal: { kind: "must-keep-key" } },
    ]);
  });
});

describe("refusalText", () => {
  const other = { id: "b", label: "Go to project" };

  it("words each refusal", () => {
    expect(refusalText({ kind: "taken", combo: "y", other }, false)).toBe(
      "Y already runs Go to project."
    );
    expect(
      refusalText(
        { kind: "opens-chord", combo: "g", other, chord: "g p" },
        false
      )
    ).toBe("G opens a chord (G P: Go to project).");
    expect(
      refusalText({ kind: "behind-single", combo: "x q", other }, false)
    ).toBe("X already runs Go to project, so it can't open a chord.");
    expect(refusalText({ kind: "must-keep-key" }, false)).toBe(
      "This command must keep a key."
    );
    expect(refusalText({ kind: "digit", combo: "5" }, false)).toBe(
      "Digits are kept for counts and seeking."
    );
    expect(refusalText({ kind: "fixed" }, false)).toBe(
      "This key can't be changed."
    );
    expect(refusalText({ kind: "invalid", combo: "?" }, false)).toBe(
      "That key can't be bound."
    );
  });

  it("renders modifiers for the platform", () => {
    const taken = { kind: "taken", combo: "mod+k", other } as const;
    expect(refusalText(taken, true)).toBe("⌘+K already runs Go to project.");
    expect(refusalText(taken, false)).toBe(
      "Ctrl+K already runs Go to project."
    );
  });
});

describe("the shipped commands", () => {
  const reserved = new Set(["keyboard-shortcuts", "command-palette"]);
  const bindable: BindableCommand[] = COMMANDS.map((c) => ({
    id: c.id,
    label: c.label,
    scope: c.scope ?? GLOBAL_SCOPE,
    defaults: c.keys ?? [],
    digits: c.yieldsToCount === true,
    reserved: reserved.has(c.id),
  }));

  it("pass their own rules with no overrides", () => {
    expect(conflicts(bindable, {})).toEqual([]);
  });
});
