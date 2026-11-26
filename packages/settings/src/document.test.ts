import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineSetting } from "./define.js";
import { documentAttributes, documentProperties } from "./document.js";
import { FIXTURE } from "./test-support.js";

const density = defineSetting({
  ...FIXTURE,
  key: "fixture.density",
  group: "fixture",
  scopes: ["user"],
  schema: z.enum(["comfortable", "compact"]),
  default: "comfortable",
  document: { attribute: "data-density", value: (v) => v },
});

/** Writes its attribute only when on. */
const grain = defineSetting({
  ...FIXTURE,
  key: "fixture.grain",
  group: "fixture",
  scopes: ["user"],
  schema: z.boolean(),
  default: false,
  document: { attribute: "data-grain", value: (v) => (v ? "" : null) },
});

const plain = defineSetting({
  ...FIXTURE,
  key: "fixture.plain",
  group: "fixture",
  scopes: ["user"],
  schema: z.string(),
  default: "",
});

/** Writes its property only when set. */
const accent = defineSetting({
  ...FIXTURE,
  key: "fixture.accent",
  group: "fixture",
  scopes: ["user"],
  schema: z.string(),
  default: "",
  document: {
    property: "--fixture-accent",
    value: (v) => (v === "" ? null : v),
  },
});

const definitions = [density, grain, plain, accent];

describe("documentAttributes", () => {
  it("maps each value with a document entry onto its attribute", () => {
    expect(
      documentAttributes(
        {
          "fixture.density": "compact",
          "fixture.grain": true,
          "fixture.plain": "x",
        },
        definitions
      )
    ).toEqual({ "data-density": "compact", "data-grain": "" });
  });

  it("drops an attribute whose value maps to null", () => {
    expect(
      documentAttributes(
        { "fixture.density": "compact", "fixture.grain": false },
        definitions
      )
    ).toEqual({ "data-density": "compact" });
  });

  it("maps a missing key from its default", () => {
    expect(documentAttributes({}, definitions)).toEqual({
      "data-density": "comfortable",
    });
  });

  it("maps a value its schema rejects from the default", () => {
    expect(
      documentAttributes(
        { "fixture.density": "roomy", "fixture.grain": "yes" },
        definitions
      )
    ).toEqual({ "data-density": "comfortable" });
  });

  it("ignores a property-form entry", () => {
    expect(
      documentAttributes({ "fixture.accent": "#ff8800" }, definitions)
    ).toEqual({ "data-density": "comfortable" });
  });
});

describe("documentProperties", () => {
  it("maps a value with a document entry onto its property", () => {
    expect(
      documentProperties({ "fixture.accent": "#ff8800" }, definitions)
    ).toEqual({ "--fixture-accent": "#ff8800" });
  });

  it("drops a property whose value maps to null", () => {
    expect(documentProperties({ "fixture.accent": "" }, definitions)).toEqual(
      {}
    );
  });

  it("maps a missing key from its default", () => {
    expect(documentProperties({}, definitions)).toEqual({});
  });

  it("ignores an attribute-form entry", () => {
    expect(
      documentProperties({ "fixture.density": "compact" }, definitions)
    ).toEqual({});
  });
});
