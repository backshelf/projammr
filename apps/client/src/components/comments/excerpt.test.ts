import { describe, expect, it } from "bun:test";
import { excerptOf } from "./excerpt";

describe("excerptOf", () => {
  it("leaves short text untouched", () => {
    expect(excerptOf("Love this take")).toBe("Love this take");
  });

  it("cuts long text at the last word boundary before the limit", () => {
    const text =
      "This vocal comp needs another pass before we can call it final for the mix";
    expect(excerptOf(text, 30)).toBe("This vocal comp needs another…");
  });

  it("collapses newlines and repeated whitespace to single spaces", () => {
    expect(excerptOf("Great   take\n\non the   chorus")).toBe(
      "Great take on the chorus"
    );
  });

  it("returns an empty string for empty input", () => {
    expect(excerptOf("")).toBe("");
    expect(excerptOf("   ")).toBe("");
  });
});
