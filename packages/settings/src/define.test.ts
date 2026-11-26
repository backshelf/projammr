import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  buildRegistry,
  defineGroup,
  defineSetting,
  type GroupModule,
} from "./define.js";
import { FIXTURE } from "./test-support.js";
import type { SettingGroup, SettingScope } from "./types.js";

const group = (id: string, order = 10): SettingGroup =>
  defineGroup({ id, section: "personal", label: id, order });

const text = <const K extends `${string}.${string}`>(
  key: K,
  group: K extends `${infer G}.${string}` ? G : never
) =>
  defineSetting({
    ...FIXTURE,
    key,
    group,
    scopes: ["user"],
    schema: z.string(),
    default: "",
  });

describe("defineGroup", () => {
  it("returns the group, frozen", () => {
    const declared = group("editor");
    expect(declared).toEqual({
      id: "editor",
      section: "personal",
      label: "editor",
      order: 10,
    });
    expect(Object.isFrozen(declared)).toBe(true);
  });

  it.each(["", "editor.lyrics"])("throws on the id %p", (id) => {
    expect(() => group(id)).toThrow(`Setting group "${id}"`);
  });
});

describe("defineSetting", () => {
  it("returns the definition, frozen", () => {
    const definition = text("editor.font", "editor");
    expect(definition.key).toBe("editor.font");
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("throws when the default does not parse the schema, naming the key", () => {
    expect(() =>
      defineSetting({
        ...FIXTURE,
        key: "editor.size",
        group: "editor",
        scopes: ["user"],
        schema: z.number().min(1),
        default: 0,
      })
    ).toThrow('Setting "editor.size": the default does not parse its schema');
  });

  it("throws on empty scopes, naming the key", () => {
    expect(() =>
      defineSetting({
        ...FIXTURE,
        key: "editor.font",
        group: "editor",
        scopes: [],
        schema: z.string(),
        default: "",
      })
    ).toThrow('Setting "editor.font": scopes is empty');
  });

  it.each<SettingScope[]>([
    ["instance", "user"],
    ["user", "instance", "project"],
    ["user", "user"],
  ])("throws on scopes not running highest first: %p", (...scopes) => {
    expect(() =>
      defineSetting({
        ...FIXTURE,
        key: "editor.font",
        group: "editor",
        scopes,
        schema: z.string(),
        default: "",
      })
    ).toThrow('Setting "editor.font": scopes run highest first');
  });

  it.each<SettingScope[]>([
    ["user", "project", "instance"],
    ["project", "instance"],
    ["instance"],
  ])("accepts the cascade %p", (...scopes) => {
    expect(() =>
      defineSetting({
        ...FIXTURE,
        key: "editor.font",
        group: "editor",
        scopes,
        schema: z.string(),
        default: "",
      })
    ).not.toThrow();
  });

  it("throws when the key's first segment is not its group", () => {
    expect(() =>
      defineSetting({
        ...FIXTURE,
        key: "lyrics.font",
        // @ts-expect-error the group is the key's first segment
        group: "editor",
        scopes: ["user"],
        schema: z.string(),
        default: "",
      })
    ).toThrow('Setting "lyrics.font": a key is its group\'s id');
  });

  it("throws on a key with no name after its group", () => {
    expect(() => text("editor.", "editor")).toThrow('Setting "editor."');
  });
});

describe("buildRegistry", () => {
  const module = (
    id: string,
    settings: GroupModule["settings"],
    order = 10
  ): GroupModule => ({ group: group(id, order), settings });

  it("throws on a key declared in two group files, naming both groups", () => {
    expect(() =>
      buildRegistry({
        editor: module("editor", [text("editor.font", "editor")]),
        lyrics: module("lyrics", [text("editor.font", "editor")], 20),
      })
    ).toThrow(
      'Setting "editor.font" is declared twice, in group "editor" and in group "lyrics"'
    );
  });

  it("throws on a setting whose key names a group other than its file's", () => {
    expect(() =>
      buildRegistry({
        editor: module("editor", [text("notes.font", "notes")]),
      })
    ).toThrow(
      'Setting "notes.font" is declared in group "editor", but its key names group "notes"'
    );
  });

  it("throws on a group id declared twice", () => {
    expect(() =>
      buildRegistry({
        editor: module("editor", []),
        editorAgain: module("editor", [], 20),
      })
    ).toThrow('Setting group "editor" is declared twice');
  });

  it("throws on a document attribute two settings write", () => {
    const writing = <const K extends `${string}.${string}`>(
      key: K,
      group: K extends `${infer G}.${string}` ? G : never
    ) =>
      defineSetting({
        ...FIXTURE,
        key,
        group,
        scopes: ["user"],
        schema: z.string(),
        default: "",
        document: { attribute: "data-font", value: (v) => v },
      });
    expect(() =>
      buildRegistry({
        editor: module("editor", [writing("editor.font", "editor")]),
        notes: module("notes", [writing("notes.font", "notes")], 20),
      })
    ).toThrow(
      'Setting "notes.font" writes the document attribute "data-font", which "editor.font" already writes'
    );
  });

  it("throws on a document property two settings write", () => {
    const writing = <const K extends `${string}.${string}`>(
      key: K,
      group: K extends `${infer G}.${string}` ? G : never
    ) =>
      defineSetting({
        ...FIXTURE,
        key,
        group,
        scopes: ["user"],
        schema: z.string(),
        default: "",
        document: { property: "--accent", value: (v) => v },
      });
    expect(() =>
      buildRegistry({
        editor: module("editor", [writing("editor.font", "editor")]),
        notes: module("notes", [writing("notes.font", "notes")], 20),
      })
    ).toThrow(
      'Setting "notes.font" writes the document property "--accent", which "editor.font" already writes'
    );
  });

  it("orders groups by order then id, and settings by group", () => {
    const { groups, settings } = buildRegistry({
      beta: module("beta", [text("beta.a", "beta")], 20),
      alpha: module("alpha", [text("alpha.b", "alpha")], 20),
      gamma: module("gamma", [text("gamma.c", "gamma")], 5),
    });
    expect(groups.map(({ id }) => id)).toEqual(["gamma", "alpha", "beta"]);
    expect(Object.keys(settings)).toEqual(["gamma.c", "alpha.b", "beta.a"]);
    expect(Object.isFrozen(groups)).toBe(true);
    expect(Object.isFrozen(settings)).toBe(true);
  });
});
