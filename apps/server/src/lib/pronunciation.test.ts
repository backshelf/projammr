import { describe, expect, it } from "bun:test";
import {
  analyzeWord,
  assonanceKey,
  buildPronunciation,
  findRhymes,
  lookup,
  rhymeKey,
  slantKeys,
  syllableCount,
  tailKey,
} from "./pronunciation.js";

/**
 * Real CMU entries, kept small so a test names every word that can turn up in
 * a result. `star`, `bar`, `car`, `almanzar` and `guitar` share the perfect key
 * "AA R"; `sonar` and `boxcar` only share the tail, so they are the near set.
 */
const entries: Record<string, string> = {
  abductor: "AE0 B D AH1 K T ER0",
  "abductor(2)": "AH0 B D AH1 K T ER0",
  accredit: "AH0 K R EH2 D AH0 T",
  almanzar: "AA0 L M AA0 N Z AA1 R",
  bar: "B AA1 R",
  bottle: "B AA1 T AH0 L",
  boxcar: "B AA1 K S K AA2 R",
  car: "K AA1 R",
  checkered: "CH EH1 K ER0 D",
  "don't": "D OW1 N T",
  guitar: "G IH0 T AA1 R",
  "livin'": "L IH1 V IH0 N",
  "r.": "AA1 R",
  record: "R AH0 K AO1 R D",
  "record(2)": "R EH1 K ER0 D",
  reward: "R IH0 W AO1 R D",
  shh: "SH",
  sonar: "S OW1 N AA0 R",
  star: "S T AA1 R",
  unnaturally: "AH0 N N AE1 CH ER0 AH0 L IY0",
  water: "W AO1 T ER0",
  wine: "W AY1 N",
};

const p = buildPronunciation(entries);
const phones = (word: string) => entries[word]!.split(" ");
const words = (list: { word: string }[]) => list.map((entry) => entry.word);
const nothingIsCommon = () => false;

describe("syllableCount", () => {
  it("counts one stress mark per syllable", () => {
    expect(syllableCount(phones("car"))).toBe(1);
    expect(syllableCount(phones("water"))).toBe(2);
    expect(syllableCount(phones("unnaturally"))).toBe(5);
  });
});

describe("rhymeKey", () => {
  it("starts at the last primary-stressed vowel", () => {
    expect(rhymeKey(phones("car"))).toBe("AA R");
    expect(rhymeKey(phones("record"))).toBe("AO R D");
  });

  it("falls back to secondary stress when nothing carries primary", () => {
    expect(rhymeKey(phones("accredit"))).toBe("EH D AH T");
  });

  it("has no key for a word with no vowel", () => {
    expect(rhymeKey(phones("shh"))).toBeNull();
    expect(tailKey(phones("shh"))).toBeNull();
  });
});

describe("assonanceKey", () => {
  it("takes the stressed vowel on its own", () => {
    expect(assonanceKey(phones("car"))).toBe("AA");
    expect(assonanceKey(phones("record"))).toBe("AO");
  });

  it("falls back to secondary stress, and has nothing without a vowel", () => {
    expect(assonanceKey(phones("accredit"))).toBe("EH");
    expect(assonanceKey(phones("shh"))).toBeNull();
  });
});

describe("slantKeys", () => {
  it("prefixes the assonance and tail keys by kind", () => {
    expect(slantKeys(phones("record"))).toEqual(["v:AO", "t:AO R D"]);
  });

  it("lets two words that share only their stressed vowel meet", () => {
    const shared = slantKeys(phones("car")).filter((k) =>
      slantKeys(phones("bottle")).includes(k)
    );
    expect(shared).toEqual(["v:AA"]);
  });

  it("has no keys for a word with no vowel", () => {
    expect(slantKeys(phones("shh"))).toEqual([]);
  });
});

describe("buildPronunciation", () => {
  it("collects a headword's variants under one entry", () => {
    expect(p.entries.get("record")).toEqual([
      phones("record"),
      phones("record(2)"),
    ]);
    expect(p.entries.has("record(2)")).toBe(false);
  });

  it("files a word under every variant's keys", () => {
    expect(p.perfect.get("AO R D")).toEqual(["record", "reward"]);
    expect(p.perfect.get("EH K ER D")).toEqual(["checkered", "record"]);
  });

  it("files a word once when its variants agree on a key", () => {
    expect(p.perfect.get("AH K T ER")).toEqual(["abductor"]);
  });
});

describe("lookup", () => {
  it("finds a word wrapped in punctuation", () => {
    expect(lookup(p, "Don't,")).toEqual([phones("don't")]);
  });

  it("keeps a trailing apostrophe rather than stripping it away", () => {
    expect(lookup(p, "livin'")).toEqual([phones("livin'")]);
    expect(lookup(p, "livin")).toBeNull();
  });

  it("sums the parts of a hyphenated compound", () => {
    expect(lookup(p, "wine-bottle")).toEqual([
      [...phones("wine"), ...phones("bottle")],
    ]);
  });

  it("returns null for a word it does not know", () => {
    expect(lookup(p, "skrrt")).toBeNull();
  });
});

describe("analyzeWord", () => {
  it("reports the dictionary's preferred pronunciation", () => {
    expect(analyzeWord(p, "Record")).toEqual({
      word: "Record",
      syllables: 2,
      estimated: false,
      rhymeKey: "AO R D",
      slantKeys: ["v:AO", "t:AO R D"],
    });
  });

  it("estimates a count of at least one off-dictionary", () => {
    const analysis = analyzeWord(p, "skrrt");
    expect(analysis.estimated).toBe(true);
    expect(analysis.syllables).toBeGreaterThanOrEqual(1);
    expect(analysis.rhymeKey).toBeNull();
    expect(analysis.slantKeys).toEqual([]);
  });
});

describe("findRhymes", () => {
  it("excludes the query itself and abbreviations", () => {
    const result = findRhymes(p, "car", nothingIsCommon, 10);
    expect(words(result.perfect)).not.toContain("car");
    expect(words(result.perfect)).not.toContain("r.");
  });

  it("ranks a common word above every uncommon one", () => {
    const onlyBar = findRhymes(p, "car", (word) => word === "bar", 10);
    expect(words(onlyBar.perfect)[0]).toBe("bar");

    const onlyAlmanzar = findRhymes(
      p,
      "car",
      (word) => word === "almanzar",
      10
    );
    expect(words(onlyAlmanzar.perfect)[0]).toBe("almanzar");
  });

  it("keeps the near set clear of the perfect set", () => {
    const result = findRhymes(p, "star", nothingIsCommon, 10);
    expect(words(result.perfect).sort()).toEqual([
      "almanzar",
      "bar",
      "car",
      "guitar",
    ]);
    expect(words(result.near).sort()).toEqual(["boxcar", "sonar"]);
    expect(result.syllables).toBe(1);
  });

  it("caps each list only after ranking", () => {
    const result = findRhymes(p, "car", (word) => word === "almanzar", 2);
    expect(words(result.perfect)).toEqual(["almanzar", "bar"]);
  });

  it("answers with empty lists for a word it does not know", () => {
    expect(findRhymes(p, "skrrt", nothingIsCommon, 10)).toEqual({
      word: "skrrt",
      syllables: null,
      perfect: [],
      near: [],
    });
  });
});
