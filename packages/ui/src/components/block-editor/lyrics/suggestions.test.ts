import { describe, expect, it, mock } from "bun:test";
import type { LyricsDictionary } from "./context";
import type { LyricsEditor } from "./schema";
import { abortable, rhymeItems, synonymItems } from "./suggestions";

const editor = () =>
  ({ insertInlineContent: mock() }) as unknown as LyricsEditor & {
    insertInlineContent: ReturnType<typeof mock>;
  };

const dictionary = (
  overrides: Partial<LyricsDictionary>
): LyricsDictionary => ({
  analyze: mock(async () => []),
  rhymes: mock(async () => ({ perfect: [], near: [] })),
  synonyms: mock(async () => []),
  ...overrides,
});

describe("rhymeItems", () => {
  const rhymes = dictionary({
    rhymes: async () => ({
      perfect: [
        { word: "silver", syllables: 2, score: 300 },
        { word: "river", syllables: 2, score: 280 },
      ],
      near: [{ word: "deliver", syllables: 3, score: 120 }],
    }),
  });

  it("lists perfect rhymes before near ones", async () => {
    const items = await rhymeItems(
      editor(),
      rhymes,
      "quiver",
      new AbortController().signal
    );

    expect(items.map((item) => [item.group, item.title])).toEqual([
      ["Perfect", "silver"],
      ["Perfect", "river"],
      ["Near", "deliver"],
    ]);
  });

  it("badges each rhyme with its syllable count", async () => {
    const items = await rhymeItems(
      editor(),
      rhymes,
      "quiver",
      new AbortController().signal
    );

    expect(items.map((item) => item.badge)).toEqual(["2", "2", "3"]);
  });

  it("inserts the chosen word at the cursor", async () => {
    const target = editor();
    const items = await rhymeItems(
      target,
      rhymes,
      "quiver",
      new AbortController().signal
    );

    items[1]!.onItemClick();

    expect(target.insertInlineContent).toHaveBeenCalledWith("river");
  });
});

describe("synonymItems", () => {
  it("groups each sense's words by part of speech and keeps its definition", async () => {
    const items = await synonymItems(
      editor(),
      dictionary({
        synonyms: async () => [
          { pos: "noun", definition: "a burning", words: ["blaze", "flame"] },
          { pos: "verb", definition: "to burn", words: ["blaze"] },
        ],
      }),
      "fire",
      new AbortController().signal
    );

    expect(items).toMatchObject([
      { title: "blaze", group: "noun", subtext: "a burning" },
      { title: "flame", group: "noun", subtext: "a burning" },
      { title: "blaze", group: "verb", subtext: "to burn" },
    ]);
  });
});

describe("abortable", () => {
  it("aborts the previous query's signal when a new query arrives", async () => {
    const signals: AbortSignal[] = [];
    const getItems = abortable(async (_query: string, signal: AbortSignal) => {
      signals.push(signal);
      return [];
    });

    await getItems("qui");
    expect(signals[0]!.aborted).toBe(false);

    await getItems("quiv");

    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("answers a failed lookup with no items", async () => {
    const getItems = abortable(async () => {
      throw new Error("aborted");
    });

    await expect(getItems("quiver")).resolves.toEqual([]);
  });
});
