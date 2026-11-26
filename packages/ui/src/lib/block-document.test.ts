import { describe, expect, it } from "bun:test";
import {
  isBlankDocument,
  isBlankStoredDocument,
  parseInitialValue,
} from "./block-document";

const blocks = [
  { type: "paragraph", content: [{ type: "text", text: "a line" }] },
];

const emptyDocument = [{ type: "paragraph" }];

describe("parseInitialValue", () => {
  it("reads a stored block array", () => {
    expect<unknown>(parseInitialValue(JSON.stringify(blocks))).toEqual(blocks);
  });

  it("unwraps a double-encoded block array", () => {
    expect<unknown>(
      parseInitialValue(JSON.stringify(JSON.stringify(blocks)))
    ).toEqual(blocks);
  });

  it("wraps legacy plain text in a paragraph", () => {
    expect<unknown>(parseInitialValue("just some words")).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "just some words" }],
      },
    ]);
  });

  it("wraps legacy plain text that was stored JSON-encoded", () => {
    expect<unknown>(
      parseInitialValue(JSON.stringify("just some words"))
    ).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "just some words" }],
      },
    ]);
  });

  it("gives an empty document for an empty string", () => {
    expect<unknown>(parseInitialValue("")).toEqual(emptyDocument);
  });

  it("gives an empty document for a missing value", () => {
    expect<unknown>(parseInitialValue(undefined)).toEqual(emptyDocument);
  });

  it("gives an empty document for a value that is not a block array", () => {
    expect<unknown>(
      parseInitialValue(JSON.stringify({ notes: "a line" }))
    ).toEqual(emptyDocument);
  });
});

const body = (text: string) => [
  { type: "paragraph", content: [{ type: "text", text }] },
];

describe("isBlankDocument", () => {
  it("is true for the empty paragraph an editor opens with", () => {
    const opened = [{ type: "paragraph" }];
    const cleared = [{ type: "paragraph", content: [] }];
    expect(isBlankDocument(opened)).toBe(true);
    expect(isBlankDocument(cleared)).toBe(true);
  });

  it("is false once anything is written, at any depth", () => {
    expect(isBlankDocument(body("a"))).toBe(false);
    const nested = [{ type: "bulletListItem", children: body("a") }];
    expect(isBlankDocument(nested)).toBe(false);
  });
});

describe("isBlankStoredDocument", () => {
  it("is true for a value that was never written", () => {
    expect(isBlankStoredDocument(null)).toBe(true);
    expect(isBlankStoredDocument(undefined)).toBe(true);
    expect(isBlankStoredDocument("")).toBe(true);
  });

  it("is true for a stored document holding only the empty paragraph", () => {
    expect(isBlankStoredDocument(emptyDocument)).toBe(true);
    expect(isBlankStoredDocument(JSON.stringify(emptyDocument))).toBe(true);
  });

  it("is false for a stored document with text, in any encoding", () => {
    expect(isBlankStoredDocument(body("a line"))).toBe(false);
    expect(isBlankStoredDocument(JSON.stringify(body("a line")))).toBe(false);
    expect(isBlankStoredDocument("legacy plain text")).toBe(false);
  });
});
