import { describe, expect, it } from "bun:test";
import { SETTINGS } from "./registry.js";
import type { RegisteredSetting } from "./registry.js";

/** The nine personal group files under `groups/`. */
const NEW_GROUP_IDS: ReadonlySet<string> = new Set([
  "appearance",
  "feedback",
  "formats",
  "lab",
  "layout",
  "pages",
  "palette",
  "playback",
  "visuals",
]);

/** The personal keys in the `editor` group. */
const NEW_EDITOR_KEYS = new Set([
  "editor.rhymeSuggestions",
  "editor.synonymSuggestions",
  "editor.newNoteMode",
  "editor.syllableCounts",
  "editor.rhymeLetters",
]);

/** Every custom control the hub registers, from the settings-hub report. */
const CUSTOM_CONTROL_NAMES = new Set([
  "ordered-list",
  "lab-speed-range",
  "lab-pitch-range",
  "palette-aliases",
  "delete-confirms",
  "lab-compressor",
  "lab-reverb",
  "lab-eq",
]);

const settings: [string, RegisteredSetting][] = Object.entries(SETTINGS).filter(
  ([key, setting]) =>
    NEW_GROUP_IDS.has(setting.group) || NEW_EDITOR_KEYS.has(key)
);

describe("the personal groups", () => {
  it("declares at least one setting per new group and every new editor key", () => {
    const groupsSeen: ReadonlySet<string> = new Set(
      settings
        .map(([, setting]) => setting.group as string)
        .filter((group) => NEW_GROUP_IDS.has(group))
    );
    expect(groupsSeen).toEqual(NEW_GROUP_IDS);

    const editorKeysSeen: ReadonlySet<string> = new Set(
      settings.map(([key]) => key).filter((key) => NEW_EDITOR_KEYS.has(key))
    );
    expect(editorKeysSeen).toEqual(NEW_EDITOR_KEYS);
  });

  it.each([
    "formats.weekStart",
    "formats.timeZone",
    "formats.tempoRounding",
    "formats.tempoSuffix",
    "formats.keyNotation",
    "lab.normaliseTarget",
    "visuals.loudnessReference",
  ] as const)("%s lets a project set it for its members", (key) => {
    expect(SETTINGS[key].scopes).toEqual(["user", "project", "instance"]);
  });

  it.each(settings)(
    "%s has a default that parses its own schema",
    (_, setting) => {
      expect(setting.schema.safeParse(setting.default).success).toBe(true);
    }
  );

  it.each(settings.filter(([, setting]) => setting.document !== undefined))(
    "%s's document entry returns a string or null at the default",
    (_, setting) => {
      const document = setting.document as {
        value(v: unknown): string | null;
      };
      const result = document.value(setting.default);
      expect(result === null || typeof result === "string").toBe(true);
    }
  );

  it.each(settings.filter(([, setting]) => setting.control.kind === "select"))(
    "%s's select default is one of its options",
    (_, setting) => {
      const { control } = setting;
      if (control.kind !== "select") throw new Error("unreachable");
      expect(
        control.options.map((option) => option.value as unknown)
      ).toContain(setting.default);
    }
  );

  it.each(settings.filter(([, setting]) => setting.control.kind === "custom"))(
    "%s's custom control is one of the registered ones",
    (_, setting) => {
      const { control } = setting;
      if (control.kind !== "custom") throw new Error("unreachable");
      expect(CUSTOM_CONTROL_NAMES.has(control.component)).toBe(true);
    }
  );
});
