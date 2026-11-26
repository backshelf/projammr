import type { PartialBlock } from "@blocknote/core";
import { describe, expect, it } from "bun:test";
import { splitSoftBreaks } from "./normalise";

const text = (text: string, styles: Record<string, unknown> = {}) =>
  ({ type: "text", text, styles }) as const;

const paragraph = (
  content: Extract<PartialBlock["content"], unknown[]>,
  id = "block-1"
): PartialBlock => ({ id, type: "paragraph", content });

describe("splitSoftBreaks", () => {
  it("leaves a paragraph without soft breaks untouched", () => {
    const blocks = [paragraph([text("one line")])];

    expect(splitSoftBreaks(blocks)[0]).toBe(blocks[0]);
  });

  it("splits a soft-broken paragraph into one block per line", () => {
    const result = splitSoftBreaks([paragraph([text("a\nb")])]);

    expect(result).toEqual([
      { id: "block-1", type: "paragraph", content: [text("a")] },
      { id: undefined, type: "paragraph", content: [text("b")] },
    ]);
  });

  it("carries the styles of the run each line came from", () => {
    const result = splitSoftBreaks([paragraph([text("a\nb", { bold: true })])]);

    expect(result).toEqual([
      {
        id: "block-1",
        type: "paragraph",
        content: [text("a", { bold: true })],
      },
      {
        id: undefined,
        type: "paragraph",
        content: [text("b", { bold: true })],
      },
    ]);
  });

  it("starts the next line at the following run when a run ends in a break", () => {
    const result = splitSoftBreaks([
      paragraph([text("a\n"), text("b", { italic: true })]),
    ]);

    expect(result).toEqual([
      { id: "block-1", type: "paragraph", content: [text("a")] },
      {
        id: undefined,
        type: "paragraph",
        content: [text("b", { italic: true })],
      },
    ]);
  });

  it("leaves a paragraph holding non-text inline content alone", () => {
    const blocks = [
      paragraph([
        { type: "link", href: "https://example.com", content: [text("a\nb")] },
      ]),
    ];

    expect(splitSoftBreaks(blocks)[0]).toBe(blocks[0]);
  });
});
