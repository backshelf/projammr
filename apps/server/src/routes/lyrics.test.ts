import { beforeAll, describe, expect, it } from "bun:test";
import { loadPronunciation } from "../lib/pronunciation.js";
import { loadThesaurus } from "../lib/thesaurus.js";
import { setupSuite } from "../test/fixtures.js";

// Warmed up front so the dictionary's cold-build cost lands here rather than
// inside an individual test's timeout.
beforeAll(async () => {
  await Promise.all([loadPronunciation(), loadThesaurus()]);
});

const suite = setupSuite("Lyrics");
const { request } = suite;

describe("POST /lyrics/analyze", () => {
  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/lyrics/analyze", {
      method: "POST",
      body: JSON.stringify({ words: ["car"] }),
    });
    expect(res.status).toBe(401);
  });

  it("answers a signed-in caller with no project relationship", async () => {
    const res = await request("outsider", "/lyrics/analyze", {
      method: "POST",
      body: JSON.stringify({ words: ["car"] }),
    });
    expect(res.status).toBe(200);
  });

  it("returns syllable counts in the order words were sent, estimating unknown ones", async () => {
    const res = await request("outsider", "/lyrics/analyze", {
      method: "POST",
      body: JSON.stringify({ words: ["car", "Water,", "finna"] }),
    });
    expect(res.status).toBe(200);

    const { words } = await res.json();
    expect(words).toHaveLength(3);
    expect(words[0]).toMatchObject({
      word: "car",
      syllables: 1,
      estimated: false,
    });
    expect(words[1]).toMatchObject({
      word: "Water,",
      syllables: 2,
      estimated: false,
    });
    expect(words[2]).toMatchObject({ word: "finna", estimated: true });
  });

  it("rejects a batch over 500 words", async () => {
    const res = await request("outsider", "/lyrics/analyze", {
      method: "POST",
      body: JSON.stringify({ words: Array.from({ length: 501 }, () => "car") }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty batch", async () => {
    const res = await request("outsider", "/lyrics/analyze", {
      method: "POST",
      body: JSON.stringify({ words: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /lyrics/rhymes", () => {
  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/lyrics/rhymes?word=car");
    expect(res.status).toBe(401);
  });

  it("answers a signed-in caller with no project relationship", async () => {
    const res = await request("outsider", "/lyrics/rhymes?word=car");
    expect(res.status).toBe(200);
  });

  it("finds perfect rhymes containing a common word, with near rhymes disjoint from them", async () => {
    const res = await request("outsider", "/lyrics/rhymes?word=car");
    expect(res.status).toBe(200);

    const body = await res.json();
    const perfectWords = body.perfect.map(
      (entry: { word: string }) => entry.word
    );
    const nearWords = body.near.map((entry: { word: string }) => entry.word);

    expect(perfectWords).toContain("bar");
    expect(nearWords.length).toBeGreaterThan(0);
    expect(perfectWords.some((word: string) => nearWords.includes(word))).toBe(
      false
    );
  });

  it("caps both perfect and near rhymes at the given limit", async () => {
    const res = await request("outsider", "/lyrics/rhymes?word=car&limit=3");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.perfect.length).toBeLessThanOrEqual(3);
    expect(body.near.length).toBeLessThanOrEqual(3);
  });

  it("answers 200 with empty results for a word absent from the dictionary", async () => {
    const res = await request("outsider", "/lyrics/rhymes?word=zzzzq");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ syllables: null, perfect: [], near: [] });
  });
});

describe("GET /lyrics/synonyms", () => {
  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/lyrics/synonyms?word=car");
    expect(res.status).toBe(401);
  });

  it("answers a signed-in caller with no project relationship", async () => {
    const res = await request("outsider", "/lyrics/synonyms?word=car");
    expect(res.status).toBe(200);
  });

  it("finds a sense containing 'automobile' and sets the cache header", async () => {
    const res = await request("outsider", "/lyrics/synonyms?word=car");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");

    const body = await res.json();
    const words = body.senses.flatMap(
      (sense: { words: string[] }) => sense.words
    );
    expect(words).toContain("automobile");
  });
});
