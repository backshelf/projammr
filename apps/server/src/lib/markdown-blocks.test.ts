import { describe, expect, it } from "bun:test";
import type { BlockDocument } from "../db/schema/base.js";
import {
  blocksToMarkdown,
  type ConvertMode,
  markdownToBlocks,
} from "./markdown-blocks.js";

type Styles = Partial<Record<"bold" | "italic" | "strike" | "code", true>>;

const text = (value: string, styles: Styles = {}) => ({
  type: "text",
  text: value,
  styles,
});

const block = (
  type: string,
  content: unknown[] | undefined,
  props: Record<string, unknown> = {},
  children: Record<string, unknown>[] = []
) => ({ id: crypto.randomUUID(), type, props, content, children });

const paragraph = (...content: unknown[]) => block("paragraph", content);

/** A document with every `id` removed, at any depth. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(([key, inner]) => [key, withoutIds(inner)])
    );
  }
  return value;
}

function expectRoundTrip(
  doc: BlockDocument,
  mode: ConvertMode,
  existing?: BlockDocument
) {
  const markdown = blocksToMarkdown(doc, mode);
  expect(withoutIds(markdownToBlocks(markdown, mode, existing))).toEqual(
    withoutIds(doc)
  );
  return markdown;
}

describe("markdown round trip", () => {
  it("keeps bold, italic, strike and code runs", () => {
    const doc = [
      paragraph(
        text("plain "),
        text("bold", { bold: true }),
        text(" "),
        text("italic", { italic: true }),
        text(" "),
        text("gone", { strike: true }),
        text(" "),
        text("x * y", { code: true })
      ),
    ];
    expect(expectRoundTrip(doc, "document")).toBe(
      "plain **bold** *italic* ~~gone~~ `x * y`"
    );
  });

  it("keeps every sequence of three styled runs, including runs ending mid-word", () => {
    const sets: Styles[] = [
      {},
      { bold: true },
      { italic: true },
      { strike: true },
      { code: true },
      { bold: true, italic: true },
      { bold: true, code: true },
      { italic: true, strike: true },
    ];
    for (const a of sets) {
      for (const b of sets) {
        for (const c of sets) {
          if (JSON.stringify(a) === JSON.stringify(b)) continue;
          if (JSON.stringify(b) === JSON.stringify(c)) continue;
          expectRoundTrip(
            [paragraph(text("ab", a), text("cd", b), text("ef", c))],
            "lyrics"
          );
        }
      }
    }
  });

  it("keeps a link inside a bold run", () => {
    const doc = [
      paragraph(
        text("see ", { bold: true }),
        {
          type: "link",
          href: "https://example.com/a_(b)",
          content: [
            text("the ", { bold: true }),
            text("docs", { bold: true, italic: true }),
          ],
        },
        text(" now", { bold: true })
      ),
    ];
    expect(expectRoundTrip(doc, "document")).toBe(
      "**see [the *docs*](https://example.com/a_(b\\)) now**"
    );
  });

  it("keeps headings of every level", () => {
    const doc = [1, 2, 3, 4, 5, 6].map((level) =>
      block("heading", [text(`Level ${level}`)], { level })
    );
    expectRoundTrip(doc, "document");
    expectRoundTrip(doc, "lyrics");
  });

  it("keeps a bullet list three levels deep", () => {
    const doc = [
      block("bulletListItem", [text("one")], {}, [
        block("bulletListItem", [text("two")], {}, [
          block("bulletListItem", [text("three")]),
        ]),
        block("bulletListItem", [text("two again")]),
      ]),
      block("bulletListItem", [text("one again")]),
    ];
    expect(expectRoundTrip(doc, "document")).toBe(
      "- one\n  - two\n    - three\n  - two again\n- one again"
    );
  });

  it("keeps a numbered list", () => {
    const doc = [
      block("numberedListItem", [text("first")]),
      block("numberedListItem", [text("second")]),
    ];
    expect(expectRoundTrip(doc, "document")).toBe("1. first\n1. second");
  });

  it("keeps both check states", () => {
    const doc = [
      block("checkListItem", [text("done")], { checked: true }),
      block("checkListItem", [text("todo")], { checked: false }),
    ];
    expect(expectRoundTrip(doc, "document")).toBe("- [x] done\n- [ ] todo");
  });

  it("keeps a quote", () => {
    const doc = [
      block("quote", [text("said "), text("loudly", { italic: true })]),
    ];
    expect(expectRoundTrip(doc, "document")).toBe("> said *loudly*");
  });

  it("keeps a code block and puts a table back from the existing document", () => {
    const table = {
      id: "table-1",
      type: "table",
      props: { textColor: "default" },
      content: { type: "tableContent", rows: [{ cells: [[text("cell")]] }] },
      children: [],
    };
    const doc = [
      paragraph(text("before")),
      block("codeBlock", [text("const a = 1;\n```\n<!-- keep:x -->")], {
        language: "typescript",
      }),
      table,
      { id: "divider-1", type: "divider", props: {}, children: [] },
      paragraph(text("after")),
    ];
    const markdown = expectRoundTrip(doc, "document", [table]);
    expect(markdown).toContain("<!-- keep:table-1 -->");
    expect(markdown).toContain("````typescript\n");
  });

  it("keeps a lyric with three verses and a chorus section", () => {
    const doc = [
      block("section", [text("Verse 1")]),
      paragraph(text("first line")),
      paragraph(text("second "), text("line", { italic: true })),
      block("paragraph", []),
      block("section", [text("Chorus")]),
      paragraph(text("sing it")),
      block("paragraph", []),
      paragraph(text("third verse")),
      block("paragraph", []),
    ];
    expect(expectRoundTrip(doc, "lyrics")).toBe(
      "[Verse 1]\nfirst line\nsecond *line*\n\n[Chorus]\nsing it\n\nthird verse\n"
    );
  });

  it("keeps empty paragraphs at the start and end of a lyric", () => {
    expectRoundTrip(
      [block("paragraph", []), paragraph(text("only")), block("paragraph", [])],
      "lyrics"
    );
  });

  it("keeps a document paragraph's hard line break", () => {
    expectRoundTrip([paragraph(text("one\n# two"))], "document");
  });
});

describe("markdownToBlocks", () => {
  const parse = (markdown: string, mode: ConvertMode = "document") =>
    withoutIds(markdownToBlocks(markdown, mode));

  it("reads an unmatched * as literal text", () => {
    expect(parse("2 * 3")).toEqual([
      { type: "paragraph", props: {}, content: [text("2 * 3")], children: [] },
    ]);
  });

  it("reads a backslash-escaped ** as literal text", () => {
    expect(parse("\\*\\*not bold\\*\\*")).toEqual([
      {
        type: "paragraph",
        props: {},
        content: [text("**not bold**")],
        children: [],
      },
    ]);
  });

  it("reads an underscore inside a word as literal text", () => {
    expect(parse("take_01_final.wav and _this_", "lyrics")).toEqual([
      {
        type: "paragraph",
        props: {},
        content: [
          text("take_01_final.wav and "),
          text("this", { italic: true }),
        ],
        children: [],
      },
    ]);
  });

  it("does not pair an opener with an escaped closer", () => {
    expect(parse("*a \\*")).toEqual([
      { type: "paragraph", props: {}, content: [text("*a *")], children: [] },
    ]);
  });

  it("nests a check item at depth two", () => {
    expect(parse("- one\n  - two\n    - [ ] three")).toEqual([
      {
        type: "bulletListItem",
        props: {},
        content: [text("one")],
        children: [
          {
            type: "bulletListItem",
            props: {},
            content: [text("two")],
            children: [
              {
                type: "checkListItem",
                props: { checked: false },
                content: [text("three")],
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("reads [Chorus] in document mode as a paragraph", () => {
    expect(parse("[Chorus]")).toEqual([
      {
        type: "paragraph",
        props: {},
        content: [text("[Chorus]")],
        children: [],
      },
    ]);
  });

  it("reads a fence in lyrics mode as a paragraph", () => {
    expect(parse("```", "lyrics")).toEqual([
      { type: "paragraph", props: {}, content: [text("```")], children: [] },
    ]);
  });

  it("joins document lines into one paragraph and makes each lyric line its own", () => {
    expect(parse("one\ntwo")).toEqual([
      {
        type: "paragraph",
        props: {},
        content: [text("one two")],
        children: [],
      },
    ]);
    expect(parse("one\n\n\n\ntwo", "lyrics")).toEqual([
      { type: "paragraph", props: {}, content: [text("one")], children: [] },
      { type: "paragraph", props: {}, content: [], children: [] },
      { type: "paragraph", props: {}, content: [text("two")], children: [] },
    ]);
  });

  it("drops a placeholder naming no existing block", () => {
    expect(parse("<!-- keep:missing -->\nkept")).toEqual([
      { type: "paragraph", props: {}, content: [text("kept")], children: [] },
    ]);
  });

  it("gives every block a fresh id", () => {
    const [first, second] = markdownToBlocks("a\n\nb", "document");
    expect(first?.id).toEqual(expect.any(String));
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("blocksToMarkdown", () => {
  it("escapes a lyric line starting with # so it reads back as a paragraph", () => {
    const doc = [
      paragraph(text("#1 on the chart")),
      paragraph(text("[Chorus]")),
    ];
    expect(expectRoundTrip(doc, "lyrics")).toBe(
      "\\#1 on the chart\n\\[Chorus\\]"
    );
  });

  it("escapes paragraph starts that read as other blocks", () => {
    expectRoundTrip(
      [
        paragraph(text("- not a list")),
        paragraph(text("1. not numbered")),
        paragraph(text("> not a quote")),
        paragraph(text("---")),
        paragraph(text("<!-- keep:x -->")),
        paragraph(text("``` not a fence")),
      ],
      "document"
    );
  });

  it("exports a coloured, underlined run as plain text", () => {
    const doc = [
      {
        id: "p",
        type: "paragraph",
        props: {
          textColor: "red",
          backgroundColor: "default",
          textAlignment: "center",
        },
        content: [
          {
            type: "text",
            text: "loud",
            styles: { underline: true, textColor: "red" },
          },
        ],
        children: [],
      },
    ];
    expect(blocksToMarkdown(doc, "document")).toBe("loud");
  });

  it("emits the children of a non-list block after it at the same level", () => {
    const doc = [
      block("heading", [text("Title")], { level: 2 }, [
        paragraph(text("child")),
      ]),
    ];
    expect(blocksToMarkdown(doc, "document")).toBe("## Title\n\nchild");
  });

  it("writes a section as a placeholder in document mode and a code block as one in lyrics mode", () => {
    const section = { ...block("section", [text("Chorus")]), id: "s" };
    const code = { ...block("codeBlock", [text("x")]), id: "c" };
    expect(blocksToMarkdown([section], "document")).toBe("<!-- keep:s -->");
    expect(blocksToMarkdown([code], "lyrics")).toBe("<!-- keep:c -->");
  });
});
