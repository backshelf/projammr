import { describe, expect, test } from "bun:test";

import { shareStructure } from "./share";

describe("shareStructure", () => {
  test("keeps the previous object for a value that is equal to it", () => {
    const previous = { folders: [{ path: "a", sets: 1 }], error: null };
    const next = { folders: [{ path: "a", sets: 1 }], error: null };

    expect(shareStructure(previous, next)).toBe(previous);
  });

  test("keeps the parts that did not change and takes the one that did", () => {
    const previous = {
      folders: [
        { path: "a", sets: 1 },
        { path: "b", sets: 2 },
      ],
      error: null,
    };
    const next = {
      folders: [
        { path: "a", sets: 1 },
        { path: "b", sets: 3 },
      ],
      error: null,
    };

    const shared = shareStructure(previous, next);

    expect(shared).toEqual(next);
    expect(shared).not.toBe(previous);
    expect(shared.folders[0]).toBe(previous.folders[0]!);
    expect(shared.folders[1]).not.toBe(previous.folders[1]!);
  });

  test("takes an array that gained or lost an entry, sharing the entries it kept", () => {
    const previous = [{ id: 1 }, { id: 2 }];
    const next = [{ id: 1 }];

    const shared = shareStructure(previous, next);

    expect(shared).toEqual([{ id: 1 }]);
    expect(shared[0]).toBe(previous[0]!);
  });

  test("takes a value of another kind, or from nothing", () => {
    expect(shareStructure(null, { a: 1 })).toEqual({ a: 1 });
    expect(shareStructure({ a: 1 }, [1])).toEqual([1]);
    expect(shareStructure({ a: 1 }, null)).toBeNull();
    expect(shareStructure(1, 2)).toBe(2);
  });
});
