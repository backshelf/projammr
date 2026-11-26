import { describe, expect, expectTypeOf, it } from "bun:test";
import {
  GROUPS,
  SETTINGS,
  isSettingKey,
  settingsFor,
  settingsReceivedBy,
  type SettingKey,
  type SettingsValues,
} from "./registry.js";
import type { SettingScope } from "./types.js";

describe("SETTINGS", () => {
  it("is frozen, as is every definition in it", () => {
    expect(Object.isFrozen(SETTINGS)).toBe(true);
    for (const definition of Object.values(SETTINGS)) {
      expect(Object.isFrozen(definition)).toBe(true);
    }
  });

  it("keys every definition by its own key", () => {
    for (const [key, definition] of Object.entries(SETTINGS)) {
      expect<string>(definition.key).toBe(key);
    }
  });

  it("types each value by its key", () => {
    expectTypeOf<
      SettingsValues["editor.rhymePrefix"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      SettingsValues["instance-access.registration"]
    >().toEqualTypeOf<"open" | "closed">();
    expectTypeOf(
      SETTINGS["instance-access.registration"].default
    ).toEqualTypeOf<"open" | "closed">();
    expectTypeOf<"editor.nope">().not.toExtend<SettingKey>();
    // @ts-expect-error a key no group declares has no value type
    expectTypeOf<SettingsValues["editor.nope"]>();
    // @ts-expect-error a value of the wrong type for its key
    const wrong: Partial<SettingsValues> = { "editor.rhymePrefix": 4 };
    expect(wrong).toBeDefined();
  });
});

describe("GROUPS", () => {
  it("is frozen and in order", () => {
    expect(Object.isFrozen(GROUPS)).toBe(true);
    const orders = GROUPS.map(({ order }) => order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("isSettingKey", () => {
  it("accepts a registered key and nothing else", () => {
    expect(isSettingKey("editor.rhymePrefix")).toBe(true);
    expect(isSettingKey("editor.nope")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
  });
});

describe("settingsFor", () => {
  it.each<SettingScope>(["user", "project", "instance"])(
    "lists exactly the settings accepting %p, in registry order",
    (scope) => {
      expect(settingsFor(scope)).toEqual(
        Object.values(SETTINGS).filter(({ scopes }) =>
          (scopes as readonly SettingScope[]).includes(scope)
        )
      );
    }
  );

  it("lists a personal key at user scope and an instance-only key only at instance scope", () => {
    const keys = (scope: SettingScope) =>
      settingsFor(scope).map(({ key }) => key);
    expect(keys("user")).toContain("editor.rhymePrefix");
    expect(keys("user")).not.toContain("instance-access.registration");
    expect(keys("instance")).toContain("instance-access.registration");
  });
});

describe("settingsReceivedBy", () => {
  it("gives an instance admin every setting, in registry order", () => {
    expect(settingsReceivedBy(true)).toEqual(Object.values(SETTINGS));
  });

  it("leaves the admin-audience settings out for anyone else", () => {
    expect(settingsReceivedBy(false)).toEqual(
      Object.values(SETTINGS).filter(({ audience }) => audience !== "admin")
    );
    expect(settingsReceivedBy(false).map(({ key }) => key)).toContain(
      "instance-access.registration"
    );
  });
});
