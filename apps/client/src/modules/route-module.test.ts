import { describe, expect, test } from "bun:test";
import { flagOr } from "@/modules/route-module";

describe("flagOr", () => {
  test("reads 1 as on and 0 as off, whatever the default", () => {
    expect(flagOr("1", false)).toBe(true);
    expect(flagOr("0", true)).toBe(false);
  });

  test("reads a missing param as the default", () => {
    expect(flagOr(undefined, false)).toBe(false);
    expect(flagOr(undefined, true)).toBe(true);
  });

  test("reads a repeated param as the default, like searchParam", () => {
    expect(flagOr(["1", "1"], false)).toBe(false);
    expect(flagOr(["0", "0"], true)).toBe(true);
  });

  test("reads any other value as the default", () => {
    expect(flagOr("yes", false)).toBe(false);
  });
});
