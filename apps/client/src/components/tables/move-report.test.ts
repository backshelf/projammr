import { describe, expect, it } from "bun:test";

import { priorityFallbackNote } from "./move-report";

describe("priorityFallbackNote", () => {
  it("says which level fell back to which, on how many rows", () => {
    expect(priorityFallbackNote([{ from: "High", to: "None", count: 3 }])).toBe(
      "High became None on 3 rows."
    );
  });

  it("counts a single row in the singular", () => {
    expect(
      priorityFallbackNote([{ from: "Urgent", to: "Normal", count: 1 }])
    ).toBe("Urgent became Normal on 1 row.");
  });

  it("lists every level that fell back, in the order the server reported", () => {
    expect(
      priorityFallbackNote([
        { from: "High", to: "None", count: 3 },
        { from: "Urgent", to: "None", count: 1 },
      ])
    ).toBe("High became None on 3 rows, Urgent became None on 1 row.");
  });

  it("says nothing when every level carried over", () => {
    expect(priorityFallbackNote([])).toBeUndefined();
    expect(priorityFallbackNote()).toBeUndefined();
  });
});
