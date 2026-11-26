import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { GROUPS, SETTINGS } from "../registry.js";
import type { SettingDefinition } from "../types.js";

const byKey: [string, SettingDefinition][] = Object.entries(SETTINGS);

describe("the registered groups", () => {
  it.each(byKey)("%s has a default that parses its schema", (_, setting) => {
    expect(setting.schema.safeParse(setting.default).success).toBe(true);
  });

  it.each(byKey)(
    "%s belongs to the declared group its first segment names",
    (key, setting) => {
      expect(GROUPS.map(({ id }) => id)).toContain(setting.group);
      expect(key.startsWith(`${setting.group}.`)).toBe(true);
    }
  );
});

describe("groups/index.ts", () => {
  const moduleName = (file: string) => file.replace(/\.ts$/, "");
  const namespace = (file: string) =>
    moduleName(file).replace(/-(\w)/g, (_, letter: string) =>
      letter.toUpperCase()
    );

  it("registers every group file, one line each, in file order", () => {
    const files = readdirSync(new URL(".", import.meta.url))
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          file !== "index.ts" &&
          !file.endsWith(".test.ts")
      )
      .sort();
    const lines = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
      .trim()
      .split(/\r?\n/);
    expect(lines).toEqual(
      files.map(
        (file) =>
          `export * as ${namespace(file)} from "./${moduleName(file)}.js";`
      )
    );
  });
});
