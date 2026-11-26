import { BlockNoteEditor } from "@blocknote/core";
import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { Decoration } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  jest,
} from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import {
  analysisKey,
  createAnalysisPlugin,
  decorate,
  groups,
  lyricsAnalysis,
  holdCounts,
  readLines,
  scheme,
  sectionStats,
  type HeldCount,
  type LineFacts,
} from "./analysis";
import type { LyricsDictionary, WordAnalysis } from "./context";
import { lyricsSchema } from "./schema";
import { lastWord, words } from "./text";

type LyricsBlock = (typeof lyricsSchema)["PartialBlock"];

const line = (text: string): LyricsBlock => ({
  type: "paragraph",
  content: text,
});
const section = (label: string): LyricsBlock => ({
  type: "section",
  content: label,
});

const editorOf = (blocks: LyricsBlock[]) =>
  BlockNoteEditor.create({ schema: lyricsSchema, initialContent: blocks });

const docOf = (blocks: LyricsBlock[]) => editorOf(blocks).prosemirrorState.doc;

const word = (
  text: string,
  syllables: number,
  rhymeKey: string | null,
  estimated = false,
  slantKeys: string[] = rhymeKey ? [`v:${rhymeKey}`] : []
): WordAnalysis => ({ word: text, syllables, rhymeKey, estimated, slantKeys });

const cacheOf = (...entries: WordAnalysis[]) =>
  new Map(entries.map((e) => [e.word.toLowerCase(), e]));

/** The "at" family, enough to build rhyming fixtures. `back` and `bad` slant
 * against it on the vowel without joining its perfect key. */
const RHYMES = cacheOf(
  word("cat", 1, "at"),
  word("hat", 1, "at"),
  word("mat", 1, "at"),
  word("back", 1, "ack", false, ["v:at"]),
  word("bad", 1, "ad", false, ["v:at"]),
  word("the", 1, "uh"),
  word("blue", 1, "oo"),
  word("true", 1, "oo"),
  word("sky", 1, "eye")
);

const attrsOf = (deco: Decoration) =>
  (deco as unknown as { type: { attrs: Record<string, string> } }).type.attrs;

describe("words", () => {
  it("keeps apostrophes and internal hyphens inside the word", () => {
    expect(words("Don't stop, believin'")).toEqual([
      "Don't",
      "stop",
      "believin'",
    ]);
    expect(words("a well-worn coat")).toEqual(["a", "well-worn", "coat"]);
  });

  it("folds curly apostrophes onto straight ones", () => {
    expect(words("don’t")).toEqual(["don't"]);
  });

  it("reads the last word, or nothing from a wordless line", () => {
    expect(lastWord("Don't stop, believin'")).toBe("believin'");
    expect(lastWord("  —  ")).toBeNull();
  });
});

describe("readLines", () => {
  it("totals the syllables of a line whose words are all cached", () => {
    const [read] = readLines(docOf([line("cat hat")]), RHYMES);

    expect(read).toMatchObject({
      kind: "line",
      text: "cat hat",
      syllables: 2,
      estimated: false,
      rhymeKey: "at",
      unknown: [],
    });
  });

  it("withholds the total while any word is unknown", () => {
    const [read] = readLines(docOf([line("cat zzz")]), RHYMES);

    expect(read!.syllables).toBeNull();
    expect(read!.unknown).toEqual(["zzz"]);
  });

  /* The range is where the last word sits, not a claim that it rhymes with
     anything — `decorate` only draws it once the scheme has placed the line,
     which needs the last word's key. Typing in the middle of a line would
     otherwise drop the underline off a last word that never changed. */
  it("ranges the last word even while another word is unknown", () => {
    const [read] = readLines(docOf([line("zzz cat")]), RHYMES);

    expect(read!.lastWordRange).toEqual({ from: 7, to: 10 });
  });

  it("marks the line estimated when any of its words is", () => {
    const cache = cacheOf(word("cat", 1, "at"), word("zzz", 2, "zz", true));
    const [read] = readLines(docOf([line("cat zzz")]), cache);

    expect(read!.syllables).toBe(3);
    expect(read!.estimated).toBe(true);
  });

  it("takes the rhyme key from the last word, and not from an estimate", () => {
    const cache = cacheOf(word("cat", 1, "at"), word("zzz", 2, "zz", true));

    expect(readLines(docOf([line("zzz cat")]), cache)[0]!.rhymeKey).toBe("at");
    expect(readLines(docOf([line("cat zzz")]), cache)[0]!.rhymeKey).toBeNull();
  });

  it("ranges the last word in document coordinates", () => {
    const doc = docOf([line("cat hat")]);
    const [read] = readLines(doc, RHYMES);

    expect(read!.lastWordRange).toEqual({ from: 7, to: 10 });
    expect(doc.textBetween(7, 10)).toBe("hat");
  });

  it("reads a section block for its position, not its words", () => {
    const lines = readLines(docOf([section("Chorus"), line("cat")]), RHYMES);

    expect(lines.map((l) => l.kind)).toEqual(["section", "line"]);
  });
});

describe("holdCounts", () => {
  /** The same block, at two points in an edit — the id is what ties them. */
  const block = (text: string): LyricsBlock => ({
    id: "line-1",
    type: "paragraph",
    content: text,
  });
  const held = () => new Map<string, HeldCount>();

  it("keeps a resolved count for the next pass to fall back on", () => {
    const memory = held();
    holdCounts(readLines(docOf([block("cat hat")]), RHYMES), memory);

    expect(memory.get("line-1")).toEqual({ syllables: 2, estimated: false });
  });

  it("holds the last count over a line whose word is still pending", () => {
    const memory = held();
    holdCounts(readLines(docOf([block("cat hat")]), RHYMES), memory);

    const [read] = holdCounts(
      readLines(docOf([block("cat hat zz")]), RHYMES),
      memory
    );

    expect(read!.syllables).toBe(2);
    expect(read!.unknown).toEqual(["zz"]);
  });

  it("lets an emptied line lose its count", () => {
    const memory = held();
    holdCounts(readLines(docOf([block("cat hat")]), RHYMES), memory);

    const [read] = holdCounts(readLines(docOf([block("")]), RHYMES), memory);

    expect(read!.syllables).toBeNull();
    expect(memory.has("line-1")).toBe(false);
  });
});

describe("groups", () => {
  const kinds = (...ks: LineFacts["kind"][]) =>
    ks.map((kind) => ({ kind }) as LineFacts);

  it("treats a document with no section as one group", () => {
    expect(groups(kinds("line", "line", "line"))).toEqual([[0, 1, 2]]);
  });

  it("splits at each section block", () => {
    expect(groups(kinds("section", "line", "line", "section", "line"))).toEqual(
      [[1, 2], [4]]
    );
  });

  it("gives lines before the first section their own group", () => {
    expect(groups(kinds("line", "section", "line"))).toEqual([[0], [2]]);
  });
});

describe("scheme", () => {
  const read = (blocks: LyricsBlock[]) => readLines(docOf(blocks), RHYMES);
  const letters = (lines: LineFacts[], group: number[]) =>
    group.map((i) => scheme(lines, group).get(i)?.letter ?? null);

  it("letters an AABB pair scheme", () => {
    const lines = read([
      line("the cat"),
      line("the hat"),
      line("the blue"),
      line("the true"),
    ]);

    expect(letters(lines, [0, 1, 2, 3])).toEqual(["A", "A", "B", "B"]);
  });

  it("letters an ABAB pair scheme", () => {
    const lines = read([
      line("the cat"),
      line("the blue"),
      line("the hat"),
      line("the true"),
    ]);

    expect(letters(lines, [0, 1, 2, 3])).toEqual(["A", "B", "A", "B"]);
  });

  it("leaves a key used by one line alone", () => {
    const lines = read([line("the cat"), line("the sky"), line("the hat")]);

    expect(letters(lines, [0, 1, 2])).toEqual(["A", null, "A"]);
  });

  it("gives each distinct pair the next index", () => {
    const lines = read([
      line("the cat"),
      line("the hat"),
      line("the blue"),
      line("the true"),
    ]);
    const sch = scheme(lines, [0, 1, 2, 3]);

    expect(sch.get(0)!.index).toBe(0);
    expect(sch.get(2)!.index).toBe(1);
  });

  it("joins a slant line to the group it half-rhymes with, in lowercase", () => {
    const lines = read([line("the cat"), line("the hat"), line("the back")]);
    const sch = scheme(lines, [0, 1, 2]);

    expect(sch.get(2)).toEqual({ letter: "a", index: 0, slant: true });
    expect(sch.get(0)!.slant).toBe(false);
  });

  it("letters a pair that only ever rhymes slantly", () => {
    const lines = read([line("the back"), line("the sky"), line("the bad")]);

    expect(letters(lines, [0, 1, 2])).toEqual(["a", null, "a"]);
  });

  it("orders the letters by where each group first appears", () => {
    const lines = read([
      line("the back"),
      line("the bad"),
      line("the blue"),
      line("the true"),
    ]);
    const sch = scheme(lines, [0, 1, 2, 3]);

    expect(sch.get(0)!.index).toBe(0);
    expect(sch.get(2)).toEqual({ letter: "B", index: 1, slant: false });
  });

  it("restarts the letters in each section", () => {
    const lines = read([
      section("Verse"),
      line("the blue"),
      line("the true"),
      section("Chorus"),
      line("the cat"),
      line("the hat"),
    ]);

    expect(letters(lines, [1, 2])).toEqual(["A", "A"]);
    expect(letters(lines, [4, 5])).toEqual(["A", "A"]);
  });
});

describe("sectionStats", () => {
  it("counts the lines that hold words and averages their syllables", () => {
    const lines = readLines(docOf([line("cat hat"), line("cat")]), RHYMES);

    expect(sectionStats(lines, [0, 1])).toEqual({ lines: 2, average: 1.5 });
  });

  it("leaves empty lines out of the count", () => {
    const lines = readLines(
      docOf([line("cat hat"), { type: "paragraph" }]),
      RHYMES
    );

    expect(sectionStats(lines, [0, 1])).toEqual({ lines: 1, average: 2 });
  });

  it("rounds the average to one decimal", () => {
    const lines = readLines(
      docOf([line("cat"), line("cat"), line("cat hat")]),
      RHYMES
    );

    expect(sectionStats(lines, [0, 1, 2]).average).toBe(1.3);
  });

  it("withholds the average while a line is unknown", () => {
    const lines = readLines(docOf([line("cat"), line("zzz")]), RHYMES);

    expect(sectionStats(lines, [0, 1])).toEqual({ lines: 2, average: 1 });
    expect(sectionStats(lines, [1])).toEqual({ lines: 1, average: null });
  });
});

describe("decorate", () => {
  it("carries the count, the letter and the section stats", () => {
    const doc = docOf([section("Chorus"), line("the cat"), line("the hat")]);
    const found = decorate(doc, readLines(doc, RHYMES)).find();
    const attrs = found.map(attrsOf);

    expect(attrs).toContainEqual(
      expect.objectContaining({
        "data-syllables": "2",
        "data-rhyme": "A",
        style: "--rhyme-index:0",
      })
    );
    expect(attrs).toContainEqual(
      expect.objectContaining({
        "data-section-lines": "2",
        "data-section-average": "2",
      })
    );
    expect(attrs).toContainEqual(
      expect.objectContaining({ class: "lyric-rhyme" })
    );
  });

  it("dashes the underline under a slant rhyme", () => {
    const doc = docOf([line("the cat"), line("the hat"), line("the back")]);
    const attrs = decorate(doc, readLines(doc, RHYMES)).find().map(attrsOf);

    expect(attrs).toContainEqual(
      expect.objectContaining({
        "data-rhyme": "a",
        style: "--rhyme-index:0",
      })
    );
    expect(attrs).toContainEqual(
      expect.objectContaining({ class: "lyric-rhyme lyric-rhyme-slant" })
    );
  });

  it("marks an estimated count", () => {
    const cache = cacheOf(word("zzz", 2, null, true));
    const doc = docOf([line("zzz")]);
    const attrs = decorate(doc, readLines(doc, cache)).find().map(attrsOf);

    expect(attrs).toEqual([
      { "data-syllables": "2", "data-syllables-estimated": "true" },
    ]);
  });

  it("leaves an empty line undecorated", () => {
    const doc = docOf([{ type: "paragraph" }]);

    expect(decorate(doc, readLines(doc, RHYMES)).find()).toEqual([]);
  });

  it("skips the underline on a line holding a non-text inline node", () => {
    const doc = withHardBreak();
    const found = decorate(doc, readLines(doc, RHYMES)).find().map(attrsOf);

    expect(found.filter((a) => a["data-rhyme"] === "A")).toHaveLength(2);
    expect(found.filter((a) => a.class === "lyric-rhyme")).toHaveLength(1);
  });
});

/** "cat hat" followed by a hard break, then "the mat" — the two lines rhyme,
 * but only the second can be underlined. */
const withHardBreak = (): Node => {
  const editor = editorOf([line("cat hat"), line("the mat")]);
  const json = editor.prosemirrorState.doc.toJSON() as {
    content: [{ content: [{ content: [{ content: unknown[] }] }] }];
  };
  json.content[0].content[0].content[0].content.push({ type: "hardBreak" });
  return editor.pmSchema.nodeFromJSON(json);
};

describe("the analysis plugin", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("reaches ProseMirror through the extension", () => {
    const editor = BlockNoteEditor.create({
      schema: lyricsSchema,
      extensions: [lyricsAnalysis(null)],
      initialContent: [line("cat hat")],
    });
    const { plugins } = (
      editor._tiptapEditor as unknown as {
        extensionManager: { plugins: { spec: { key?: unknown } }[] };
      }
    ).extensionManager;

    expect(plugins.some((p) => p.spec.key === analysisKey)).toBe(true);
  });

  it("asks the dictionary for the words it has never seen, once settled", async () => {
    const analyze = mock(async (ws: string[]) =>
      ws.map((w) => word(w, 1, "at"))
    );
    const dictionary = { analyze } as unknown as LyricsDictionary;
    const plugin = createAnalysisPlugin(dictionary);
    let state = EditorState.create({
      doc: docOf([line("cat hat")]),
      plugins: [plugin],
    });
    const view = {
      get state() {
        return state;
      },
      isDestroyed: false,
      dispatch: (tr: ReturnType<typeof state.tr.setMeta>) => {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    plugin.spec.view!(view);
    expect(analysisKey.getState(state)!.set.find()).toEqual([]);

    await advanceTimersByTimeAsync(300);

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(["cat", "hat"]);
    expect(
      analysisKey
        .getState(state)!
        .set.find()
        .map(attrsOf)
        .some((a) => a["data-syllables"] === "2")
    ).toBe(true);
  });

  it("asks nothing without a dictionary", () => {
    const plugin = createAnalysisPlugin(null);
    const state = EditorState.create({
      doc: docOf([line("cat hat")]),
      plugins: [plugin],
    });
    const view = { state, isDestroyed: false } as unknown as EditorView;

    expect(() => plugin.spec.view!(view)).not.toThrow();
    expect(analysisKey.getState(state)!.set.find()).toEqual([]);
  });
});
