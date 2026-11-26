import { customField as field } from "@/fields/custom-field-fixture";
import { describe, expect, it } from "bun:test";

import {
  customFieldCells,
  customFieldGroupings,
  customFieldGroupKey,
  customFieldSeed,
} from "./custom-field-parts";
import { sectionDrillIn, sectionize } from "./group-sections";

const FIELDS = [
  field(1, "Mood", "select", [
    { id: "a1", label: "Dark" },
    { id: "b2", label: "Mellow" },
  ]),
  field(2, "Energy", "number"),
  field(4, "Cleared", "checkbox"),
  field(5, "Stems", "url"),
];

describe("custom field grouping", () => {
  it("offers a grouping for each select and checkbox field, narrowed by its own filter", () => {
    expect(customFieldGroupings(FIELDS)).toEqual([
      { id: "cf_1", label: "Mood", filterParam: "cf_1" },
      { id: "cf_4", label: "Cleared", filterParam: "cf_4" },
    ]);
  });

  it("keys a row as the server keys its group, and an unset one as none", () => {
    const row = { fields: { cf_1: "b2", cf_4: false } };
    expect(customFieldGroupKey(row, "cf_1")).toBe("b2");
    expect(customFieldGroupKey(row, "cf_4")).toBe("false");
    expect(customFieldGroupKey({ fields: {} }, "cf_1")).toBeNull();
  });

  it("sections rows by option, with the unset ones in the Not set bucket", () => {
    const rows: { id: number; fields: Record<string, string> }[] = [
      { id: 1, fields: { cf_1: "a1" } },
      { id: 2, fields: {} },
    ];
    const sections = sectionize(
      rows,
      (row) => customFieldGroupKey(row, "cf_1"),
      [
        { key: "a1", label: "Dark", count: 3 },
        { key: "__none__", label: "Not set", count: 1 },
      ]
    );
    expect(sections.map((s) => [s.key, s.label])).toEqual([
      ["a1", "Dark"],
      ["__none__", "Not set"],
    ]);
    // The "Show all" of a partly loaded option narrows to it by the field's filter.
    expect(sectionDrillIn(sections[0]!, "cf_1")).toEqual({
      param: "cf_1",
      value: "a1",
    });
  });
});

describe("a draft seeded under a custom field's group", () => {
  it("takes a select's option id and a checkbox's state", () => {
    expect(customFieldSeed(FIELDS, "cf_1", "b2")).toEqual({
      field: "cf_1",
      value: "b2",
    });
    expect(customFieldSeed(FIELDS, "cf_4", "true")).toEqual({
      field: "cf_4",
      value: true,
    });
    expect(customFieldSeed(FIELDS, "cf_4", "false")).toEqual({
      field: "cf_4",
      value: false,
    });
  });

  it("seeds nothing for a grouping that is no custom field's, or one the server does not group by", () => {
    expect(customFieldSeed(FIELDS, "status", "3")).toBeNull();
    expect(customFieldSeed(FIELDS, "cf_2", "7")).toBeNull();
    expect(customFieldSeed(FIELDS, "cf_99", "x")).toBeNull();
  });
});

describe("customFieldCells", () => {
  it("edits each field with its kind, labelled by its name", () => {
    expect(customFieldCells(FIELDS)).toMatchObject({
      cf_1: { type: "select", label: "Mood" },
      cf_2: { type: "number", label: "Energy" },
      cf_4: { type: "checkbox" },
      cf_5: { type: "url" },
    });
  });
});
