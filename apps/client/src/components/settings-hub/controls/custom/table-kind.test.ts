import { describe, expect, it } from "bun:test";
import { tableKindOf } from "./table-kind";

describe("tableKindOf", () => {
  it("reads the kind out of a Columns key", () => {
    expect(tableKindOf("tables.trackColumns", "Columns")).toBe("track");
  });

  it("reads the kind out of a Sort key", () => {
    expect(tableKindOf("tables.collectionSort", "Sort")).toBe("collection");
  });

  it("reads the kind out of a Grouping key", () => {
    expect(tableKindOf("tables.sessionGrouping", "Grouping")).toBe("session");
  });
});
