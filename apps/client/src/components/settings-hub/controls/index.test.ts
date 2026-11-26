import { describe, expect, it } from "bun:test";
import { SETTINGS, type SettingDefinition } from "@workspace/settings";
import { controlFor, SETTING_CONTROLS } from ".";
import { CUSTOM_CONTROLS } from "./custom";
import type { SettingControlKind } from "./types";

/** Every kind a setting can declare; the compiler holds this list to the union. */
const KINDS = Object.keys({
  colour: true,
  custom: true,
  duration: true,
  list: true,
  multiselect: true,
  number: true,
  select: true,
  slider: true,
  text: true,
  toggle: true,
} satisfies Record<SettingControlKind, true>) as SettingControlKind[];

const DEFINITIONS: readonly SettingDefinition[] = Object.values(SETTINGS);

describe("SETTING_CONTROLS", () => {
  it("has a component for every kind of control", () => {
    for (const kind of KINDS) {
      expect(typeof SETTING_CONTROLS[kind]).toBe("function");
    }
    expect(Object.keys(SETTING_CONTROLS).sort()).toEqual([...KINDS].sort());
  });

  it("lists its kinds alphabetically, one line each", () => {
    const kinds = Object.keys(SETTING_CONTROLS);
    expect(kinds).toEqual([...kinds].sort());
  });

  it("resolves the control of every declared setting", () => {
    expect(DEFINITIONS.length).toBeGreaterThan(0);
    for (const definition of DEFINITIONS) {
      expect(controlFor(definition)).toBe(
        SETTING_CONTROLS[definition.control.kind] as never
      );
    }
  });

  it("has a registered component for every custom setting", () => {
    const unregistered = DEFINITIONS.flatMap(({ key, control }) =>
      control.kind === "custom" &&
      !Object.hasOwn(CUSTOM_CONTROLS, control.component)
        ? [`${key} → ${control.component}`]
        : []
    );
    expect(unregistered).toEqual([]);
  });
});

describe("CUSTOM_CONTROLS", () => {
  it("lists its controls alphabetically, one line each", () => {
    const names = Object.keys(CUSTOM_CONTROLS);
    expect(names).toEqual([...names].sort());
  });
});
