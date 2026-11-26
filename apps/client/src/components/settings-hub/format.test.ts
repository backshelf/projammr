import { describe, expect, it } from "bun:test";
import {
  defineSetting,
  SETTINGS,
  type SettingControl,
  type SettingDefinition,
} from "@workspace/settings";
import { z } from "zod";
import {
  formatSettingValue,
  NOT_SET,
  sameSettingValue,
  settingLabel,
  settingOf,
  summariseSettingValue,
} from "./format";

/** A setting with `control`, its schema accepting anything, for the formatter alone. */
const withControl = (control: SettingControl): SettingDefinition =>
  defineSetting({
    key: "fixture.value",
    group: "fixture",
    label: "Value",
    description: "A setting declared by a test.",
    keywords: [],
    scopes: ["user"],
    schema: z.unknown(),
    default: null,
    control,
    audience: "all",
  });

const OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Invite only" },
] as const;

describe("formatSettingValue", () => {
  const cases: [string, SettingControl, unknown, string][] = [
    ["a toggle on", { kind: "toggle" }, true, "On"],
    ["a toggle off", { kind: "toggle" }, false, "Off"],
    [
      "a select by its option's label",
      { kind: "select", options: OPTIONS },
      "closed",
      "Invite only",
    ],
    [
      "a select's unknown option raw",
      { kind: "select", options: OPTIONS },
      "gone",
      "gone",
    ],
    [
      "a multiselect's labels, joined",
      { kind: "multiselect", options: OPTIONS },
      ["open", "closed"],
      "Open, Invite only",
    ],
    ["an empty list", { kind: "list", item: "path" }, [], "(none)"],
    [
      "a list's entries, joined",
      { kind: "list", item: "text" },
      ["a", "b"],
      "a, b",
    ],
    [
      "a number with its unit",
      { kind: "number", unit: "LUFS" },
      -14,
      "-14 LUFS",
    ],
    ["a number with no unit", { kind: "number" }, 3, "3"],
    [
      "a slider with its unit",
      { kind: "slider", min: 0, max: 100, step: 1, unit: "%" },
      40,
      "40 %",
    ],
    [
      "a duration of one unit",
      { kind: "duration", unit: "min" },
      1,
      "1 minute",
    ],
    ["a duration of several", { kind: "duration", unit: "d" }, 30, "30 days"],
    // eslint-disable-next-line no-restricted-syntax -- a colour setting's stored hex value, not a class name
    ["a colour as its hex", { kind: "colour" }, "#aabbcc", "#aabbcc"],
    [
      "text in quotes, on one line",
      { kind: "text" },
      "  two\n lines ",
      "“two lines”",
    ],
    ["empty text as empty quotes", { kind: "text" }, "", "“”"],
    [
      "a custom control's value raw",
      { kind: "custom", component: "Any" },
      { a: 1 },
      '{"a":1}',
    ],
  ];

  for (const [name, control, value, expected] of cases) {
    it(`reads ${name}`, () => {
      expect(formatSettingValue(withControl(control), value)).toBe(expected);
    });
  }

  it('reads no value as "(not set)", whatever the control', () => {
    expect(formatSettingValue(withControl({ kind: "toggle" }), null)).toBe(
      NOT_SET
    );
    expect(formatSettingValue(undefined, undefined)).toBe(NOT_SET);
  });

  it("prints a value its control cannot read raw", () => {
    expect(formatSettingValue(withControl({ kind: "toggle" }), "yes")).toBe(
      "yes"
    );
    expect(formatSettingValue(withControl({ kind: "number" }), [1, 2])).toBe(
      "[1,2]"
    );
  });

  it("prints the value of a setting the registry does not know raw", () => {
    expect(formatSettingValue(undefined, "loud")).toBe("loud");
    expect(formatSettingValue(undefined, true)).toBe("true");
  });

  it("reads a registered setting through its own control", () => {
    expect(
      formatSettingValue(SETTINGS["instance-access.registration"], "closed")
    ).toBe("Invite only");
  });
});

describe("summariseSettingValue", () => {
  it("keeps a value that fits one line whole", () => {
    expect(
      summariseSettingValue(withControl({ kind: "text" }), "short")
    ).toEqual({ text: "“short”" });
  });

  it("counts a long list's items, keeping the whole for its title", () => {
    const paths = ["/Volumes/Music/Projects", "/Users/me/Ableton/User Library"];
    const summary = summariseSettingValue(
      withControl({ kind: "list", item: "path" }),
      paths
    );

    expect(summary).toEqual({ text: "2 items", whole: paths.join(", ") });
  });

  it("cuts long text to its first 40 characters, keeping the whole", () => {
    const text = "x".repeat(60);
    const summary = summariseSettingValue(
      withControl({ kind: "custom", component: "Any" }),
      text
    );

    expect(summary.text).toBe(`${"x".repeat(40)}…`);
    expect(summary.whole).toBe(text);
  });
});

describe("settingLabel and settingOf", () => {
  it("names a registered key by its label", () => {
    expect(settingLabel("editor.rhymePrefix")).toBe("Rhyme prefix");
    expect(settingOf("editor.rhymePrefix")).toBe(
      SETTINGS["editor.rhymePrefix"]
    );
  });

  it("names a key the registry no longer knows by the key itself", () => {
    expect(settingLabel("player.removed")).toBe("player.removed");
    expect(settingOf("player.removed")).toBeUndefined();
  });
});

describe("sameSettingValue", () => {
  it("holds scalars and structures equal by value", () => {
    expect(sameSettingValue("a", "a")).toBe(true);
    expect(sameSettingValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameSettingValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(
      true
    );
    expect(sameSettingValue(null, null)).toBe(true);
  });

  it("tells different values apart", () => {
    expect(sameSettingValue("a", "b")).toBe(false);
    expect(sameSettingValue(["a", "b"], ["a, b"])).toBe(false);
    expect(sameSettingValue(["a"], { 0: "a" })).toBe(false);
    expect(sameSettingValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameSettingValue(null, "a")).toBe(false);
  });
});
