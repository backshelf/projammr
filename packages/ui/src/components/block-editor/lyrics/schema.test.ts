import { defaultBlockSpecs } from "@blocknote/core";
import { describe, expect, it } from "bun:test";
import { lyricsSchema } from "./schema";

describe("lyricsSchema", () => {
  it("frees Shift+Enter on the paragraph so one line is one block", () => {
    expect(
      lyricsSchema.blockSpecs.paragraph.implementation.meta?.hardBreakShortcut
    ).toBe("none");
  });

  it("carries a section block with an editable label", () => {
    expect(lyricsSchema.blockSchema.section.content).toBe("inline");
  });

  it("keeps the section block out of the default block specs", () => {
    expect(Object.keys(defaultBlockSpecs)).not.toContain("section");
  });

  it("drops the media, table and code blocks", () => {
    const types = Object.keys(lyricsSchema.blockSchema);

    expect(types).not.toContain("audio");
    expect(types).not.toContain("image");
    expect(types).not.toContain("video");
    expect(types).not.toContain("file");
    expect(types).not.toContain("table");
    expect(types).not.toContain("codeBlock");
    expect(types).toContain("heading");
  });
});
