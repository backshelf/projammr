import { describe, expect, it } from "bun:test";
import {
  MAX_PAGE_SIZE,
  offsetOf,
  paginationQuerySchema,
  parseSort,
} from "./pagination.js";

const ALLOWED = ["title", "updatedAt"] as const;

describe("parseSort", () => {
  it("parses a whitelisted key and its direction", () => {
    expect(parseSort("title.asc", ALLOWED)).toEqual({
      key: "title",
      desc: false,
    });
    expect(parseSort("title.desc", ALLOWED)).toEqual({
      key: "title",
      desc: true,
    });
  });

  it("treats a missing direction as ascending", () => {
    expect(parseSort("updatedAt", ALLOWED)).toEqual({
      key: "updatedAt",
      desc: false,
    });
  });

  it("reads only `desc` as descending", () => {
    expect(parseSort("title.DESC", ALLOWED)).toEqual({
      key: "title",
      desc: false,
    });
    expect(parseSort("title.backwards", ALLOWED)).toEqual({
      key: "title",
      desc: false,
    });
  });

  it("rejects a key outside the whitelist", () => {
    // Null, not a default key: the caller leaves the ordering alone rather
    // than sorting on a column with no index behind it.
    expect(parseSort("password.asc", ALLOWED)).toBeNull();
    expect(parseSort("id", ALLOWED)).toBeNull();
  });

  it("rejects nothing to sort by", () => {
    expect(parseSort(undefined, ALLOWED)).toBeNull();
    expect(parseSort("", ALLOWED)).toBeNull();
    expect(parseSort(".desc", ALLOWED)).toBeNull();
  });

  it("reads the first segment of an over-segmented string", () => {
    expect(parseSort("title.desc.extra", ALLOWED)).toEqual({
      key: "title",
      desc: true,
    });
  });
});

describe("paginationQuerySchema", () => {
  it("clamps a pageSize above the max instead of rejecting it", () => {
    expect(
      paginationQuerySchema.parse({ pageSize: MAX_PAGE_SIZE + 1000 }).pageSize
    ).toBe(MAX_PAGE_SIZE);
  });

  it("passes a pageSize within range through unchanged", () => {
    expect(paginationQuerySchema.parse({ pageSize: 25 }).pageSize).toBe(25);
  });

  it("still rejects a pageSize below the minimum", () => {
    expect(() => paginationQuerySchema.parse({ pageSize: 0 })).toThrow();
  });
});

describe("offsetOf", () => {
  it("starts the first page at zero", () => {
    expect(offsetOf(1, 25)).toBe(0);
  });

  it("steps a whole page at a time", () => {
    expect(offsetOf(2, 25)).toBe(25);
    expect(offsetOf(4, 25)).toBe(75);
    expect(offsetOf(3, 200)).toBe(400);
  });

  it("goes backwards for a page below one", () => {
    // The route schema floors `page` at 1, so this pins what the bare helper
    // does rather than a state the API can reach.
    expect(offsetOf(0, 25)).toBe(-25);
    expect(offsetOf(-1, 25)).toBe(-50);
  });
});
