import { describe, expect, it } from "bun:test";
import {
  BUILT_IN_VIEW_QUERY,
  defaultViewQuery,
  hasViewParams,
  unshowableBoardQuery,
} from "./default-view";

describe("unshowableBoardQuery", () => {
  it("rewrites a board the list cannot show to the list, keeping every other param", () => {
    const query = unshowableBoardQuery(
      { view: "board", q: "demo", tag: ["1", "2"] },
      false
    );
    expect(new URLSearchParams(query).getAll("tag")).toEqual(["1", "2"]);
    expect(new URLSearchParams(query).get("q")).toBe("demo");
    expect(new URLSearchParams(query).get("view")).toBe("list");
  });

  it("leaves a board the list can show alone", () => {
    expect(unshowableBoardQuery({ view: "board" }, true)).toBeUndefined();
  });

  it("leaves a list, or no view, alone either way", () => {
    expect(unshowableBoardQuery({ view: "list" }, false)).toBeUndefined();
    expect(unshowableBoardQuery({}, false)).toBeUndefined();
  });

  it("names a view on its target, so the target is never redirected again", () => {
    const query = unshowableBoardQuery({ view: "board" }, false)!;
    const target = Object.fromEntries(new URLSearchParams(query));
    expect(hasViewParams(target)).toBe(true);
    expect(unshowableBoardQuery(target, false)).toBeUndefined();
  });
});

describe("hasViewParams", () => {
  it("is false for an empty URL", () => {
    expect(hasViewParams({})).toBe(false);
  });

  it("is false for a bare peek — peeking a row is not naming a view", () => {
    expect(hasViewParams({ peek: "5" })).toBe(false);
  });

  it("is true for each display/layout param", () => {
    for (const key of ["q", "sort", "cols", "order", "w", "group", "view"]) {
      expect(hasViewParams({ [key]: "x" })).toBe(true);
    }
  });

  it("is true for the archived scope param", () => {
    expect(hasViewParams({ archived: "only" })).toBe(true);
  });

  it("is true for a declared filter", () => {
    expect(hasViewParams({ status: "3" })).toBe(true);
  });

  it("is true for a custom field filter", () => {
    expect(hasViewParams({ cf_12: "abc" })).toBe(true);
  });

  it("ignores an empty value, same as an absent one", () => {
    expect(hasViewParams({ q: "" })).toBe(false);
  });

  it("reads the first of a repeated param", () => {
    expect(hasViewParams({ q: ["", "x"] })).toBe(false);
    expect(hasViewParams({ q: ["x", ""] })).toBe(true);
  });
});

describe("defaultViewQuery", () => {
  it("always carries view=, even from an empty query", () => {
    expect(defaultViewQuery("", "list")).toBe(BUILT_IN_VIEW_QUERY);
    expect(defaultViewQuery("", "board")).toBe("view=board");
  });

  it("narrows an arbitrary query to the view vocabulary", () => {
    expect(defaultViewQuery("q=drums&page=3&bogus=1", "list")).toBe(
      "q=drums&view=list"
    );
  });

  it("overrides a view the input query already named", () => {
    expect(defaultViewQuery("view=board&sort=title.asc", "list")).toBe(
      "sort=title.asc&view=list"
    );
  });

  it("is idempotent", () => {
    const once = defaultViewQuery("q=drums&sort=title.asc", "board");
    expect(defaultViewQuery(once, "board")).toBe(once);
  });
});
