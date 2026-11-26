import { describe, expect, it } from "bun:test";
import { toBlocks } from "./blocks";

describe("toBlocks", () => {
  it("writes a heading line as a section in lyrics and a heading in a note", () => {
    expect(toBlocks(["# Chorus"], "lyrics")).toEqual([
      {
        type: "section",
        content: [{ type: "text", text: "Chorus", styles: {} }],
      },
    ]);
    expect(toBlocks(["# Chorus"], "note")).toEqual([
      {
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "Chorus", styles: {} }],
      },
    ]);
  });

  it("writes one paragraph per line and an empty paragraph for a blank line", () => {
    expect(toBlocks(["first", "", "second"], "lyrics")).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "first", styles: {} }],
      },
      { type: "paragraph" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "second", styles: {} }],
      },
    ]);
  });
});
