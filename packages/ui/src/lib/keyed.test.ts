import { keyedByContent } from "@workspace/ui/lib/keyed";
import { describe, expect, it } from "bun:test";

describe("keyedByContent", () => {
  it("keys each item by its content", () => {
    expect(keyedByContent(["a", "b"], (s) => s)).toEqual([
      { key: "a", item: "a" },
      { key: "b", item: "b" },
    ]);
  });

  it("numbers repeats so every key is unique", () => {
    const keys = keyedByContent([0.5, 0.2, 0.5, 0.5], String).map((k) => k.key);
    expect(keys).toEqual(["0.5", "0.2", "0.5#1", "0.5#2"]);
  });

  it("keeps a key when an item after it changes", () => {
    const before = keyedByContent(["x", "y", "x"], (s) => s);
    const after = keyedByContent(["x", "y", "z"], (s) => s);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
  });
});
