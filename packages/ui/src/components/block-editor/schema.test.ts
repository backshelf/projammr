import { describe, expect, it } from "bun:test";
import { lyricsSchema } from "./lyrics/schema";
import { plainSchema } from "./plain";

const TEXT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "section",
].sort();

describe("shared text-only block set", () => {
  it.each([
    ["lyricsSchema", lyricsSchema],
    ["plainSchema", plainSchema],
  ])("gives %s exactly the seven text blocks, no more", (_name, schema) => {
    expect(Object.keys(schema.blockSchema).sort()).toEqual(TEXT_BLOCK_TYPES);
  });

  it("builds the lyrics and plain schemas as distinct objects", () => {
    expect(lyricsSchema).not.toBe(plainSchema);
    expect(lyricsSchema.blockSpecs).not.toBe(plainSchema.blockSpecs);
  });
});
