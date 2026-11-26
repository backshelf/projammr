import { describe, expect, it } from "bun:test";

import {
  type GroupSummary,
  type Section,
  sectionDrillIn,
  sectionize,
} from "./group-sections";

type Row = { id: number; labels: string[] };

const groups: GroupSummary[] = [
  { key: "a", label: "Alpha", count: 5 },
  { key: "b", label: "Beta", count: 3 },
  { key: "__none__", label: "No labels", count: 2 },
];

describe("sectionize", () => {
  it("places a single-key row in one section", () => {
    const sections = sectionize<Row>(
      [{ id: 1, labels: ["a"] }],
      (r) => r.labels,
      groups
    );
    expect(sections.map((s) => s.key)).toEqual(["a"]);
    expect(sections[0]!.rows).toHaveLength(1);
  });

  it("places a multi-key row in every matching section", () => {
    const sections = sectionize<Row>(
      [{ id: 1, labels: ["a", "b"] }],
      (r) => r.labels,
      groups
    );
    expect(sections.map((s) => s.key).sort()).toEqual(["a", "b"]);
    expect(sections.every((s) => s.rows[0]!.id === 1)).toBe(true);
  });

  it("buckets an empty key list under __none__", () => {
    const sections = sectionize<Row>(
      [{ id: 1, labels: [] }],
      (r) => r.labels,
      groups
    );
    expect(sections.map((s) => s.key)).toEqual(["__none__"]);
    expect(sections[0]!.label).toBe("No labels");
  });

  it("takes header counts from the server summary, not the page", () => {
    const sections = sectionize<Row>(
      [
        { id: 1, labels: ["a"] },
        { id: 2, labels: ["a"] },
      ],
      (r) => r.labels,
      groups
    );
    expect(sections[0]!.count).toBe(5);
  });

  it("still accepts a plain string key", () => {
    const sections = sectionize<{ id: number; k: string }>(
      [{ id: 1, k: "b" }],
      (r) => r.k,
      groups
    );
    expect(sections.map((s) => s.key)).toEqual(["b"]);
  });
});

describe("sectionDrillIn", () => {
  const section = (over: Partial<Section<Row>> = {}): Section<Row> => ({
    key: "a",
    label: "Alpha",
    count: 5,
    rows: [{ id: 1, labels: ["a"] }],
    ...over,
  });

  it("drills into the grouping column's filter param on the section's key", () => {
    expect(sectionDrillIn(section(), "status")).toEqual({
      param: "status",
      value: "a",
    });
  });

  it("offers nothing when the page already holds the whole group", () => {
    expect(sectionDrillIn(section({ count: 1 }), "status")).toBeNull();
  });

  it("offers nothing when the grouping has no filter param", () => {
    expect(sectionDrillIn(section(), undefined)).toBeNull();
  });

  it("offers nothing for the no-value bucket, which has no value to filter on", () => {
    expect(sectionDrillIn(section({ key: "__none__" }), "status")).toBeNull();
  });
});
