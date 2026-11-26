import { fieldKind } from "@/fields";
import {
  customFieldKey,
  customFieldWrites,
  fieldWriteBody,
  isCustomFieldKey,
  kindForField,
  withCustomFieldValue,
} from "@/fields/custom-field";
import { describe, expect, it } from "bun:test";

describe("custom field keys", () => {
  it("names a field cf_ and its id", () => {
    expect(customFieldKey({ id: 12 })).toBe("cf_12");
  });

  it("recognises only cf_ followed by digits", () => {
    expect(isCustomFieldKey("cf_12")).toBe(true);
    expect(isCustomFieldKey("cf_")).toBe(false);
    expect(isCustomFieldKey("cf_x")).toBe(false);
    expect(isCustomFieldKey("title")).toBe(false);
  });
});

describe("kindForField", () => {
  it("enters each type with the kind of the same name, labelled by the field", () => {
    for (const type of ["text", "number", "date", "checkbox", "url"] as const) {
      expect(kindForField({ name: "Energy", type, options: [] })).toEqual({
        type,
        label: "Energy",
      });
    }
  });

  it("gives a select the field's options, valued by option id", () => {
    const config = kindForField({
      name: "Mood",
      type: "select",
      options: [
        { id: "a1", label: "Dark", colour: "#5b4b8a" }, // eslint-disable-line no-restricted-syntax -- user data
        { id: "b2", label: "Mellow" },
      ],
    });
    expect(config.options).toEqual([
      { value: "a1", label: "Dark", colour: "#5b4b8a" }, // eslint-disable-line no-restricted-syntax -- user data
      { value: "b2", label: "Mellow" },
    ]);
    expect(fieldKind(config.type).parse("mellow", config)).toEqual({
      ok: true,
      value: "b2",
    });
  });

  it("rejects a non-numeric paste into a number field, as the built-in number kind does", () => {
    const config = kindForField({
      name: "Energy",
      type: "number",
      options: [],
    });
    expect(fieldKind(config.type).parse("loud", config)).toEqual({
      ok: false,
      error: "Must be a number",
    });
  });
});

describe("withCustomFieldValue", () => {
  it("sets a value and keeps the rest of the bag", () => {
    expect(withCustomFieldValue({ cf_1: "a" }, "cf_2", 3)).toEqual({
      cf_1: "a",
      cf_2: 3,
    });
  });

  it("drops the key when the value clears it, since an unset field is absent", () => {
    expect(withCustomFieldValue({ cf_1: "a", cf_2: 3 }, "cf_2", null)).toEqual({
      cf_1: "a",
    });
  });

  it("keeps a false checkbox, which is a value", () => {
    expect(withCustomFieldValue(undefined, "cf_4", false)).toEqual({
      cf_4: false,
    });
  });
});

describe("fieldWriteBody", () => {
  it("sends a custom field's value in the fields bag", () => {
    expect(fieldWriteBody("cf_3", null)).toEqual({ fields: { cf_3: null } });
  });

  it("sends a column under its own name", () => {
    expect(fieldWriteBody("isrc", "US1")).toEqual({ isrc: "US1" });
  });
});

describe("customFieldWrites", () => {
  it("collects the custom values a draft filled, leaving blanks and columns out", () => {
    expect(
      customFieldWrites({ title: "T", cf_1: "x", cf_2: null, cf_3: false })
    ).toEqual({ cf_1: "x", cf_3: false });
  });

  it("is nothing when the draft filled no custom field", () => {
    expect(customFieldWrites({ title: "T", cf_1: null })).toBeUndefined();
  });
});
