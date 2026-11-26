import { describe, expect, expectTypeOf, it } from "bun:test";
import { z } from "zod";
import { defineSetting } from "./define.js";
import { settingsFor } from "./registry.js";
import { FIXTURE } from "./test-support.js";
import { valuesSchema } from "./values.js";

const name = defineSetting({
  ...FIXTURE,
  key: "fixture.name",
  group: "fixture",
  scopes: ["user"],
  schema: z.string().min(1),
  default: "untitled",
});

const mode = defineSetting({
  ...FIXTURE,
  key: "fixture.mode",
  group: "fixture",
  scopes: ["user"],
  schema: z.enum(["fast", "slow"]),
  default: "fast",
});

const patch = valuesSchema([name, mode]);

describe("valuesSchema", () => {
  it("accepts a patch naming any of its keys, or none", () => {
    expect(patch.parse({ "fixture.name": "Demo" })).toEqual({
      "fixture.name": "Demo",
    });
    expect(
      patch.parse({ "fixture.name": "Demo", "fixture.mode": "slow" })
    ).toEqual({ "fixture.name": "Demo", "fixture.mode": "slow" });
    expect(patch.parse({})).toEqual({});
  });

  it("accepts null for a key, which clears it", () => {
    expect(patch.parse({ "fixture.mode": null })).toEqual({
      "fixture.mode": null,
    });
  });

  it("rejects a key outside its definitions", () => {
    const result = patch.safeParse({ "fixture.name": "Demo", "fixture.x": 1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: ["fixture.x"],
      }),
    ]);
  });

  it("rejects a value its key's schema rejects", () => {
    expect(patch.safeParse({ "fixture.name": "" }).success).toBe(false);
    expect(patch.safeParse({ "fixture.mode": "medium" }).success).toBe(false);
  });

  it("does not fill an absent key from the default", () => {
    expect(patch.parse({ "fixture.mode": "slow" })).not.toHaveProperty(
      "fixture.name"
    );
  });

  it("types each member by its key", () => {
    type Patch = z.infer<typeof patch>;
    expectTypeOf<Patch["fixture.name"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<Patch["fixture.mode"]>().toEqualTypeOf<
      "fast" | "slow" | null | undefined
    >();
    // @ts-expect-error a key outside the definitions has no member
    expectTypeOf<Patch["fixture.x"]>();
  });

  it("rejects a key the scope does not accept when built from settingsFor", () => {
    const userPatch = valuesSchema(settingsFor("user"));
    expect(userPatch.safeParse({ "editor.rhymePrefix": "//" }).success).toBe(
      true
    );
    expect(
      userPatch.safeParse({ "instance-access.registration": "closed" }).success
    ).toBe(false);
  });
});
