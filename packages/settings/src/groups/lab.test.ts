import { describe, expect, it } from "bun:test";
import { resolve } from "../resolve.js";
import { SETTINGS } from "../registry.js";
import { valuesSchema } from "../values.js";
import { isRackDefault, RACK_DEFAULT, settings } from "./lab.js";

const RACK_KEYS: (keyof typeof OWN_VALUES)[] = [
  "lab.speedRange",
  "lab.pitchRange",
  "lab.compressor",
  "lab.reverb",
  "lab.eqPreset",
];

const compressor = {
  on: true,
  thresholdDb: -18,
  ratio: 4,
  attackMs: 10,
  releaseMs: 100,
  makeupDb: 2,
};

/** A value each rack key accepts that is not the rack default. */
const OWN_VALUES = {
  "lab.speedRange": { min: 0.75, max: 1.25 },
  "lab.pitchRange": { min: -3, max: 3 },
  "lab.compressor": compressor,
  "lab.reverb": { on: true, preset: "hall", wet: 0.3, preDelayMs: 20 },
  "lab.eqPreset": {
    on: true,
    bands: [{ kind: "peak", hz: 1000, gainDb: 2, q: 1 }],
  },
};

describe("the rack default", () => {
  it.each(RACK_KEYS)("%s stores it as a value of its own", (key) => {
    const definition = SETTINGS[key];
    expect(definition.schema.safeParse(RACK_DEFAULT).success).toBe(true);
    expect(definition.schema.safeParse(null).success).toBe(false);
    expect(definition.default).toEqual(RACK_DEFAULT);
  });

  it.each(RACK_KEYS)("%s still accepts a value of its own", (key) => {
    expect(SETTINGS[key].schema.safeParse(OWN_VALUES[key]).success).toBe(true);
  });

  it("is the one shape isRackDefault recognises", () => {
    expect(isRackDefault(RACK_DEFAULT)).toBe(true);
    expect(isRackDefault({ rack: false })).toBe(false);
    expect(isRackDefault({ rack: true, on: true })).toBe(false);
    expect(isRackDefault(null)).toBe(false);
    expect(isRackDefault(compressor)).toBe(false);
  });

  it("stays distinct from null in a patch, which clears the row", () => {
    const patch = valuesSchema(settings);
    expect(patch.parse({ "lab.compressor": RACK_DEFAULT })).toEqual({
      "lab.compressor": RACK_DEFAULT,
    });
    expect(patch.parse({ "lab.compressor": null })).toEqual({
      "lab.compressor": null,
    });
  });

  it.each(RACK_KEYS)(
    "%s held by a member wins over an instance value",
    (key) => {
      const resolved = resolve({
        user: { [key]: RACK_DEFAULT },
        instance: { [key]: OWN_VALUES[key] },
      })[key];
      expect(resolved).toEqual({ value: RACK_DEFAULT, source: "user" });
    }
  );

  it.each(RACK_KEYS)(
    "%s inherits the instance value once the member's row is cleared",
    (key) => {
      const resolved = resolve({
        user: {},
        instance: { [key]: OWN_VALUES[key] },
      })[key];
      expect(resolved.value).toEqual(OWN_VALUES[key]);
      expect(resolved.source).toBe("instance");
    }
  );
});
