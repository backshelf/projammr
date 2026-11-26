import { describe, expect, it } from "bun:test";

import {
  clearDefaultSavedView,
  defaultSavedViewId,
  setDefaultSavedView,
  type DefaultSavedViewMap,
} from "./default-saved-view";

describe("setDefaultSavedView", () => {
  it("sets a project's kind entry, leaving other kinds and projects untouched", () => {
    const map: DefaultSavedViewMap = {
      "1": { track: 10, collection: 11 },
      "2": { session: 20 },
    };

    const next = setDefaultSavedView(map, 1, "collection", 99);

    expect(next).toEqual({
      "1": { track: 10, collection: 99 },
      "2": { session: 20 },
    });
    expect(map).toEqual({
      "1": { track: 10, collection: 11 },
      "2": { session: 20 },
    });
  });

  it("adds a new project entry when the project has none yet", () => {
    const next = setDefaultSavedView({}, 5, "track", 1);
    expect(next).toEqual({ "5": { track: 1 } });
  });
});

describe("clearDefaultSavedView", () => {
  it("removes only the given kind, keeping the project's other kinds", () => {
    const map: DefaultSavedViewMap = { "1": { track: 10, collection: 11 } };
    const next = clearDefaultSavedView(map, 1, "track");
    expect(next).toEqual({ "1": { collection: 11 } });
  });

  it("drops the project entirely once its last kind is cleared", () => {
    const map: DefaultSavedViewMap = {
      "1": { track: 10 },
      "2": { session: 20 },
    };
    const next = clearDefaultSavedView(map, 1, "track");
    expect(next).toEqual({ "2": { session: 20 } });
  });

  it("is a no-op, returning the same reference, when there is nothing to clear", () => {
    const map: DefaultSavedViewMap = { "1": { track: 10 } };
    expect(clearDefaultSavedView(map, 1, "collection")).toBe(map);
    expect(clearDefaultSavedView(map, 2, "track")).toBe(map);
  });

  it("never touches another project's entries", () => {
    const map: DefaultSavedViewMap = {
      "1": { track: 10 },
      "2": { track: 20 },
    };
    const next = clearDefaultSavedView(map, 1, "track");
    expect(next).toEqual({ "2": { track: 20 } });
  });
});

describe("defaultSavedViewId", () => {
  it("reads a project's kind entry", () => {
    const map: DefaultSavedViewMap = { "1": { track: 10 } };
    expect(defaultSavedViewId(map, 1, "track")).toBe(10);
  });

  it("is undefined for an unset project or kind", () => {
    expect(defaultSavedViewId({}, 1, "track")).toBeUndefined();
    expect(
      defaultSavedViewId({ "1": { track: 10 } }, 1, "session")
    ).toBeUndefined();
  });
});
