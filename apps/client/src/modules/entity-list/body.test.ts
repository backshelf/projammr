import { describe, expect, it } from "bun:test";

import { listBody } from "./body";

describe("listBody", () => {
  it("shows the empty state when the kind has nothing archived", () => {
    expect(
      listBody({ scope: "archived", view: "list", archivedCount: 0 })
    ).toBe("empty");
  });

  it("shows the table when something is archived", () => {
    expect(
      listBody({ scope: "archived", view: "list", archivedCount: 3 })
    ).toBe("table");
  });

  it("shows the table when the kind has no archived count to ask", () => {
    expect(listBody({ scope: "archived", view: "list" })).toBe("table");
  });

  it("never shows the board on an archived page", () => {
    expect(
      listBody({ scope: "archived", view: "board", archivedCount: 3 })
    ).toBe("table");
  });

  it("shows the board on a live page that asks for it", () => {
    expect(listBody({ scope: "live", view: "board" })).toBe("board");
  });

  it("shows the table on a live page by default", () => {
    expect(listBody({ scope: "live", view: "list", archivedCount: 0 })).toBe(
      "table"
    );
  });
});
