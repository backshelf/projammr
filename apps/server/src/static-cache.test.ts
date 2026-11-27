import { describe, expect, it } from "bun:test";
import { VARIANT_WIDTHS } from "./lib/images.js";
import { staticCacheControl } from "./static.js";

describe("staticCacheControl", () => {
  it("uses private 1-hour caching for original assets and audio", () => {
    expect(staticCacheControl(undefined)).toBe("private, max-age=3600");
  });

  it("uses private 1-year immutable caching for every resized image variant", () => {
    for (const width of VARIANT_WIDTHS) {
      expect(staticCacheControl(width)).toBe(
        "private, max-age=31536000, immutable"
      );
    }
  });
});
