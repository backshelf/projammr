import { describe, expect, it } from "bun:test";
import { LruSet } from "./lru-set.js";

describe("LruSet", () => {
  it("reports a value it holds and not one it never saw", () => {
    const set = new LruSet<string>(3);
    set.add("a");
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("evicts the least recently touched member once over capacity", () => {
    const set = new LruSet<string>(2);
    set.add("a");
    set.add("b");
    set.add("c"); // over capacity: "a" is the oldest untouched member

    expect(set.has("a")).toBe(false);
    expect(set.has("b")).toBe(true);
    expect(set.has("c")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("counts a read as a touch, so a value checked again survives its neighbour's eviction", () => {
    const set = new LruSet<string>(2);
    set.add("a");
    set.add("b");
    set.has("a"); // promotes "a" back to most-recently-used
    set.add("c"); // "b" is now the oldest

    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });
});
