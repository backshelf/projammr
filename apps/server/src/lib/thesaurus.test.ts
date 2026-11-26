import type { Synset } from "wordpos";
import { describe, expect, it } from "bun:test";
import {
  loadThesaurus,
  parseIndexLemmas,
  toSynonymResult,
} from "./thesaurus.js";

/**
 * The shape of a real index file: two licence-header lines, then data lines
 * that lead with the lemma. `ice_cream` is the multi-word case.
 */
const INDEX_FIXTURE = `  1 This software and database is being provided to you, the LICENSEE, by
  2 Princeton University under the following license.
bar n 1 1 @ 1 1 02796623
car n 5 3 @ ~ %p 5 4 02961779
ice_cream n 1 2 @ ~ 1 0 07615190
star n 8 5 @ ~ %p + ; 8 5 09444783
`;

const synset = (pos: string, def: string, synonyms: string[]): Synset => ({
  pos,
  def,
  synonyms,
});

const carSynsets = [
  synset("n", "a motor vehicle with four wheels", [
    "car",
    "auto",
    "automobile",
    "motorcar",
  ]),
  synset("n", "a wheeled vehicle adapted to the rails of railroad", [
    "car",
    "railcar",
    "railway_car",
  ]),
  synset("n", "where passengers ride up and down  ", ["car", "elevator_car"]),
];

describe("parseIndexLemmas", () => {
  it("keeps the single-word lemmas and skips the header", () => {
    expect([...parseIndexLemmas(INDEX_FIXTURE)]).toEqual([
      "bar",
      "car",
      "star",
    ]);
  });

  it("returns nothing for a file that is only a header", () => {
    expect(parseIndexLemmas("  1 licence text  \n  2 more text  \n").size).toBe(
      0
    );
  });
});

describe("toSynonymResult", () => {
  it("drops the query word and spaces out multi-word lemmas", () => {
    const result = toSynonymResult("car", carSynsets, 20);
    expect(result.word).toBe("car");
    expect(result.senses.map((sense) => sense.words)).toEqual([
      ["auto", "automobile", "motorcar"],
      ["railcar", "railway car"],
      ["elevator car"],
    ]);
  });

  it("trims the definition and names the part of speech", () => {
    const senses = toSynonymResult(
      "great",
      [
        synset("s", "relatively large in size", ["big", "great"]),
        synset("v", "to run fast", ["belt_along", "bucket_along"]),
        synset("r", "very well", ["fantastically"]),
      ],
      20
    ).senses;
    expect(senses.map((sense) => sense.pos)).toEqual([
      "adjective",
      "verb",
      "adverb",
    ]);
    expect(toSynonymResult("car", carSynsets, 20).senses[2]!.definition).toBe(
      "where passengers ride up and down"
    );
  });

  it("drops a sense whose only synonym was the query word", () => {
    const result = toSynonymResult(
      "bar",
      [
        synset("n", "a rigid piece of metal", ["bar"]),
        synset("n", "a room where alcohol is served", ["bar", "barroom"]),
      ],
      20
    );
    expect(result.senses).toEqual([
      {
        pos: "noun",
        definition: "a room where alcohol is served",
        words: ["barroom"],
      },
    ]);
  });

  it("counts the limit across every sense", () => {
    const result = toSynonymResult("car", carSynsets, 4);
    expect(result.senses.map((sense) => sense.words)).toEqual([
      ["auto", "automobile", "motorcar"],
      ["railcar"],
    ]);
  });
});

describe("loadThesaurus", () => {
  it("looks synonyms up through wordpos", async () => {
    const { lookupSynonyms } = await loadThesaurus();
    const result = await lookupSynonyms("car", 20);
    const words = result.senses.flatMap((sense) => sense.words);
    expect(words).toContain("automobile");
    expect(words).not.toContain("car");
    expect(result.senses.every((sense) => sense.definition.length > 0)).toBe(
      true
    );
  });

  it("returns no senses for a word WordNet does not hold", async () => {
    const { lookupSynonyms } = await loadThesaurus();
    expect(await lookupSynonyms("zzzznotaword", 20)).toEqual({
      word: "zzzznotaword",
      senses: [],
    });
  });

  it("knows a dictionary word from a surname", async () => {
    const { isCommon, lemmas } = await loadThesaurus();
    expect(lemmas.size).toBeGreaterThan(80_000);
    expect(isCommon("bar")).toBe(true);
    expect(isCommon("Guitar")).toBe(true);
    expect(isCommon("almanzar")).toBe(false);
  });
});
