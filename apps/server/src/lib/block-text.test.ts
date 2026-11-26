import { describe, expect, it } from "bun:test";
import { blockLines, noteSummaryText } from "./block-text.js";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: text === "" ? [] : [{ type: "text", text }],
});

describe("blockLines", () => {
  it("returns one line per block, in document order", () => {
    expect(
      blockLines([paragraph("first"), paragraph("second"), paragraph("third")])
    ).toEqual(["first", "second", "third"]);
  });

  it("walks children after their parent", () => {
    expect(
      blockLines([
        { ...paragraph("parent"), children: [paragraph("child")] },
        paragraph("sibling"),
      ])
    ).toEqual(["parent", "child", "sibling"]);
  });

  it("joins the runs of a block and reads through a link", () => {
    expect(
      blockLines([
        {
          type: "heading",
          content: [
            { type: "text", text: "see " },
            { type: "link", content: [{ type: "text", text: "the bridge" }] },
          ],
        },
      ])
    ).toEqual(["see the bridge"]);
  });

  it("gives a block with no inline content an empty line", () => {
    expect(blockLines([{ type: "divider" }, paragraph("after")])).toEqual([
      "",
      "after",
    ]);
  });

  it("trims each line", () => {
    expect(blockLines([paragraph("  padded  ")])).toEqual(["padded"]);
  });

  it("returns nothing for a document that is not an array", () => {
    expect(blockLines(null)).toEqual([]);
    expect(blockLines({ type: "paragraph" })).toEqual([]);
  });
});

describe("noteSummaryText", () => {
  it("takes the first two written lines, skipping blank blocks", () => {
    expect(
      noteSummaryText([
        paragraph(""),
        {
          type: "heading",
          content: [
            { type: "text", text: "Verse " },
            { type: "link", content: [{ type: "text", text: "one" }] },
          ],
        },
        paragraph(""),
        paragraph("the preview line"),
        paragraph("ignored"),
      ])
    ).toEqual({ title: "Verse one", preview: "the preview line" });
  });

  it("leaves both fields empty for an empty document", () => {
    expect(noteSummaryText([])).toEqual({ title: "", preview: "" });
    expect(noteSummaryText([paragraph("")])).toEqual({
      title: "",
      preview: "",
    });
  });

  it("caps the title and preview at 200 characters", () => {
    const long = "a".repeat(500);
    const summary = noteSummaryText([paragraph(long), paragraph(long)]);
    expect(summary.title).toHaveLength(200);
    expect(summary.preview).toHaveLength(200);
  });
});
