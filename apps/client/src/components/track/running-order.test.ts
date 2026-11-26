import { describe, expect, it } from "bun:test";
import { runningOrder } from "./running-order";

const siblings = [
  { id: 1, title: "One" },
  { id: 2, title: "Two" },
  { id: 3, title: "Three" },
];

describe("runningOrder", () => {
  it("has no previous track for the first track", () => {
    expect(runningOrder(siblings, 1)).toEqual({
      position: 1,
      total: 3,
      previous: null,
      next: { id: 2, title: "Two" },
    });
  });

  it("has no next track for the last track", () => {
    expect(runningOrder(siblings, 3)).toEqual({
      position: 3,
      total: 3,
      previous: { id: 2, title: "Two" },
      next: null,
    });
  });

  it("finds both neighbours for a middle track", () => {
    expect(runningOrder(siblings, 2)).toEqual({
      position: 2,
      total: 3,
      previous: { id: 1, title: "One" },
      next: { id: 3, title: "Three" },
    });
  });

  it("returns a null position when the track is not in the list", () => {
    expect(runningOrder(siblings, 99)).toEqual({
      position: null,
      total: 3,
      previous: null,
      next: null,
    });
  });

  it("returns a null position and zero total for an empty list", () => {
    expect(runningOrder([], 1)).toEqual({
      position: null,
      total: 0,
      previous: null,
      next: null,
    });
  });
});
