import { beforeEach, describe, expect, it, mock } from "bun:test";

const GET = mock();
const POST = mock();

mock.module("@/lib/browser-api", () => ({
  browserApi: { GET, POST },
}));

const { browserLyricsDictionary } = await import("./lyrics-dictionary");

const wordAnalysis = (word: string) => ({
  word,
  syllables: word.length,
  estimated: false,
  rhymeKey: word[0] ?? null,
  slantKeys: [] as string[],
});

beforeEach(() => {
  GET.mockReset();
  POST.mockReset();
});

describe("browserLyricsDictionary.analyze", () => {
  it("issues one request for two concurrent calls sharing a word", async () => {
    POST.mockImplementation(
      async () => ({ data: { words: [wordAnalysis("moon")] } }) as const
    );

    const [a, b] = await Promise.all([
      browserLyricsDictionary.analyze(["moon"]),
      browserLyricsDictionary.analyze(["Moon"]),
    ]);

    expect(POST).toHaveBeenCalledTimes(1);
    expect(a).toEqual([wordAnalysis("moon")]);
    expect(b).toEqual([wordAnalysis("moon")]);
  });

  it("issues no request for a word already cached", async () => {
    POST.mockImplementation(
      async () => ({ data: { words: [wordAnalysis("light")] } }) as const
    );

    await browserLyricsDictionary.analyze(["light"]);
    expect(POST).toHaveBeenCalledTimes(1);

    POST.mockClear();
    const result = await browserLyricsDictionary.analyze(["light"]);

    expect(POST).not.toHaveBeenCalled();
    expect(result).toEqual([wordAnalysis("light")]);
  });
});

describe("browserLyricsDictionary.rhymes", () => {
  it("retries a rejected call on the next call for the same word", async () => {
    GET.mockRejectedValueOnce(new Error("network error"));

    await expect(browserLyricsDictionary.rhymes("stone")).rejects.toThrow(
      "network error"
    );
    expect(GET).toHaveBeenCalledTimes(1);

    GET.mockResolvedValueOnce({
      data: {
        word: "stone",
        syllables: 1,
        perfect: [{ word: "bone", syllables: 1, score: 1 }],
        near: [],
      },
    });

    const result = await browserLyricsDictionary.rhymes("stone");

    expect(GET).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      perfect: [{ word: "bone", syllables: 1, score: 1 }],
      near: [],
    });
  });
});
