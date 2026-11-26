import { describe, expect, expectTypeOf, it } from "bun:test";
import { z } from "zod";
import { defineSetting } from "./define.js";
import { SETTINGS } from "./registry.js";
import {
  resolve,
  resolveSetting,
  type SettingLayers,
  type SettingLocks,
} from "./resolve.js";
import { FIXTURE } from "./test-support.js";
import type { Resolved } from "./types.js";

/** A personal key that also takes project and instance values. */
const layered = defineSetting({
  ...FIXTURE,
  key: "fixture.layered",
  group: "fixture",
  scopes: ["user", "project", "instance"],
  schema: z.string().min(1),
  default: "fallback",
});

/** A project key: no personal value. */
const projectOnly = defineSetting({
  ...FIXTURE,
  key: "fixture.projectOnly",
  group: "fixture",
  scopes: ["project", "instance"],
  schema: z.string().min(1),
  default: "fallback",
});

const everyScope: SettingLayers = {
  user: { "fixture.layered": "mine" },
  project: { "fixture.layered": "project's" },
  instance: { "fixture.layered": "instance's" },
};

const locked = (
  scope: "project" | "instance",
  ...keys: string[]
): SettingLocks => ({ [scope]: new Set(keys) });

describe("resolveSetting precedence", () => {
  it("takes the highest declared scope holding a value", () => {
    expect(resolveSetting(layered, everyScope)).toEqual({
      value: "mine",
      source: "user",
    });
    expect(resolveSetting(layered, { ...everyScope, user: undefined })).toEqual(
      { value: "project's", source: "project" }
    );
    expect(resolveSetting(layered, { instance: everyScope.instance })).toEqual({
      value: "instance's",
      source: "instance",
    });
  });

  it("walks only the key's own scopes, ignoring a layer it does not list", () => {
    expect(
      resolveSetting(projectOnly, {
        user: { "fixture.projectOnly": "mine" },
        instance: { "fixture.projectOnly": "instance's" },
      })
    ).toEqual({ value: "instance's", source: "instance" });
  });

  it("puts env below every declared scope and above the default", () => {
    const env = { "fixture.layered": "from env" };
    expect(resolveSetting(layered, { env })).toEqual({
      value: "from env",
      source: "env",
    });
    expect(
      resolveSetting(layered, { instance: everyScope.instance, env })
    ).toEqual({ value: "instance's", source: "instance" });
  });

  it("falls to the default for a key no layer holds", () => {
    expect(resolveSetting(layered, {})).toEqual({
      value: "fallback",
      source: "default",
    });
    expect(
      resolveSetting(layered, { user: { "fixture.other": "x" }, env: {} })
    ).toEqual({ value: "fallback", source: "default" });
  });

  it("hands each caller its own copy of the default", () => {
    const list = defineSetting({
      ...FIXTURE,
      key: "fixture.list",
      group: "fixture",
      scopes: ["user"],
      schema: z.array(z.string()),
      default: ["a", "b"],
    });
    resolveSetting(list, {}).value.push("c");
    expect(resolveSetting(list, {}).value).toEqual(["a", "b"]);
    expect(list.default).toEqual(["a", "b"]);
  });

  it("returns what the schema parsed, not the stored value", () => {
    const shaped = defineSetting({
      ...FIXTURE,
      key: "fixture.shaped",
      group: "fixture",
      scopes: ["user"],
      schema: z.object({ size: z.number() }),
      default: { size: 1 },
    });
    expect(
      resolveSetting(shaped, {
        user: { "fixture.shaped": { size: 2, stale: true } },
      })
    ).toEqual({ value: { size: 2 }, source: "user" });
  });
});

describe("resolveSetting invalid values", () => {
  it("skips a value its schema rejects and reports the scope", () => {
    expect(
      resolveSetting(layered, {
        ...everyScope,
        user: { "fixture.layered": "" },
      })
    ).toEqual({ value: "project's", source: "project", invalid: ["user"] });
  });

  it("reports every rejected scope it passed, highest first", () => {
    expect(
      resolveSetting(layered, {
        user: { "fixture.layered": 4 },
        project: { "fixture.layered": null },
        env: { "fixture.layered": "from env" },
      })
    ).toEqual({
      value: "from env",
      source: "env",
      invalid: ["user", "project"],
    });
  });

  it("skips a rejected env value without reporting it", () => {
    expect(resolveSetting(layered, { env: { "fixture.layered": "" } })).toEqual(
      { value: "fallback", source: "default" }
    );
  });
});

describe("resolveSetting locks", () => {
  it("pins a project-locked key to the project's value", () => {
    expect(
      resolveSetting(layered, everyScope, locked("project", "fixture.layered"))
    ).toEqual({ value: "project's", source: "project", lockedBy: "project" });
  });

  it("pins an instance-locked key to the instance's value", () => {
    expect(
      resolveSetting(layered, everyScope, locked("instance", "fixture.layered"))
    ).toEqual({
      value: "instance's",
      source: "instance",
      lockedBy: "instance",
    });
  });

  it("lets the instance lock win when both scopes lock the key", () => {
    expect(
      resolveSetting(layered, everyScope, {
        ...locked("project", "fixture.layered"),
        ...locked("instance", "fixture.layered"),
      })
    ).toEqual({
      value: "instance's",
      source: "instance",
      lockedBy: "instance",
    });
  });

  it("ignores a lock at a scope with no row for the key", () => {
    expect(
      resolveSetting(
        layered,
        { user: everyScope.user, instance: everyScope.instance },
        locked("project", "fixture.layered")
      )
    ).toEqual({ value: "mine", source: "user" });
  });

  it("ignores a lock at a scope the key does not accept", () => {
    const personal = defineSetting({
      ...FIXTURE,
      key: "fixture.personal",
      group: "fixture",
      scopes: ["user", "instance"],
      schema: z.string(),
      default: "fallback",
    });
    expect(
      resolveSetting(
        personal,
        {
          user: { "fixture.personal": "mine" },
          project: { "fixture.personal": "project's" },
        },
        locked("project", "fixture.personal")
      )
    ).toEqual({ value: "mine", source: "user" });
  });

  it("ignores a lock on a key declared not lockable", () => {
    const unlockable = defineSetting({
      ...FIXTURE,
      key: "fixture.unlockable",
      group: "fixture",
      scopes: ["project", "instance"],
      schema: z.string(),
      default: "fallback",
      lockable: false,
    });
    expect(
      resolveSetting(
        unlockable,
        {
          project: { "fixture.unlockable": "project's" },
          instance: { "fixture.unlockable": "instance's" },
        },
        locked("instance", "fixture.unlockable")
      )
    ).toEqual({ value: "project's", source: "project" });
  });

  it("ignores a lock on another key", () => {
    expect(
      resolveSetting(layered, everyScope, locked("instance", "fixture.other"))
    ).toEqual({ value: "mine", source: "user" });
  });

  it("keeps the lock when its row is rejected, taking the scope below it", () => {
    expect(
      resolveSetting(
        layered,
        { ...everyScope, project: { "fixture.layered": "" } },
        locked("project", "fixture.layered")
      )
    ).toEqual({
      value: "instance's",
      source: "instance",
      lockedBy: "project",
      invalid: ["project"],
    });
  });
});

describe("resolve", () => {
  it("resolves every registered key", () => {
    expect(Object.keys(resolve({}))).toEqual(Object.keys(SETTINGS));
  });

  it("gives each key its default when no layer holds it", () => {
    const resolved = resolve({});
    for (const [key, definition] of Object.entries(SETTINGS)) {
      expect(
        resolved[key as keyof typeof resolved] as Resolved<unknown>
      ).toEqual({
        value: definition.default,
        source: "default",
      });
    }
  });

  it("types each key's value by its key", () => {
    const resolved = resolve({ user: { "editor.rhymePrefix": "//" } });
    expect(resolved["editor.rhymePrefix"]).toEqual({
      value: "//",
      source: "user",
    });
    expectTypeOf(resolved["editor.rhymePrefix"]).toEqualTypeOf<
      Resolved<string>
    >();
  });
});
