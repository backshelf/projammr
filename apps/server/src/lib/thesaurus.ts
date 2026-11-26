/**
 * WordNet's lemma set — the only local signal for "is this a real word" —
 * and the synonym senses behind the lyrics thesaurus.
 *
 * WordNet's licence notice ships in THIRD_PARTY_NOTICES.md at the repo root,
 * as its terms require.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Synset } from "wordpos";

type SynonymSense = {
  pos: "noun" | "verb" | "adjective" | "adverb";
  definition: string;
  words: string[];
};

export type SynonymResult = { word: string; senses: SynonymSense[] };

export type Thesaurus = {
  /** Every single-word WordNet lemma — around 83k of them. */
  lemmas: Set<string>;
  /** Membership test in the shape `findRhymes` takes as its ranking signal. */
  isCommon: (word: string) => boolean;
  lookupSynonyms: (word: string, limit: number) => Promise<SynonymResult>;
};

const INDEX_FILES = ["index.noun", "index.verb", "index.adj", "index.adv"];

const POS_NAMES: Record<string, SynonymSense["pos"]> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  // A satellite adjective ("amazing" under "awesome") is still an adjective.
  s: "adjective",
  r: "adverb",
};

/**
 * The lemmas of one WordNet index file. Data lines lead with the lemma;
 * the licence header's lines lead with a space. Multi-word lemmas
 * (`ice_cream`) are dropped — nothing asks whether a phrase is a word.
 */
export const parseIndexLemmas = (text: string): Set<string> => {
  const lemmas = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const lemma = line.split(" ", 1)[0]!;
    if (lemma && !lemma.includes("_")) lemmas.add(lemma);
  }
  return lemmas;
};

/**
 * One sense per synset, the query word dropped from its own synonym list, and
 * `limit` counted across the flattened words rather than per sense — a word
 * with eight senses should not return eight times as many synonyms as one
 * with a single sense.
 */
export const toSynonymResult = (
  word: string,
  synsets: Synset[],
  limit: number
): SynonymResult => {
  const query = word.trim().toLowerCase();
  const senses: SynonymSense[] = [];
  let taken = 0;
  for (const synset of synsets) {
    if (taken >= limit) break;
    const pos = POS_NAMES[synset.pos];
    if (!pos) continue;
    const words = synset.synonyms
      .map((synonym) => synonym.replaceAll("_", " "))
      .filter((synonym) => synonym.toLowerCase() !== query)
      .slice(0, limit - taken);
    if (words.length === 0) continue;
    taken += words.length;
    senses.push({ pos, definition: synset.def.trim(), words });
  }
  return { word, senses };
};

const build = async (): Promise<Thesaurus> => {
  const [{ default: WordPOS }, { default: wordnetDb }] = await Promise.all([
    import("wordpos"),
    import("wordnet-db"),
  ]);

  const texts = await Promise.all(
    INDEX_FILES.map((name) => readFile(join(wordnetDb.path, name), "utf8"))
  );
  const lemmas = new Set<string>();
  for (const text of texts) {
    for (const lemma of parseIndexLemmas(text)) lemmas.add(lemma);
  }

  // Stopwords are words too: "the" and "with" are ordinary lyrics, and the
  // thesaurus is asked about whatever the writer clicked.
  const wordpos = new WordPOS({ stopwords: false });

  return {
    lemmas,
    isCommon: (word) => lemmas.has(word.toLowerCase()),
    // `lookup` lowercases and turns spaces into underscores itself, so only
    // stray whitespace has to go; a word it does not hold resolves to [].
    lookupSynonyms: async (word, limit) =>
      toSynonymResult(word, await wordpos.lookup(word.trim()), limit),
  };
};

let loading: Promise<Thesaurus> | undefined;

/**
 * Reading the four index files and indexing WordNet costs hundreds of
 * milliseconds and tens of megabytes, so both wait until someone asks —
 * every test file and the typegen script import the app. `src/server.ts`
 * warms it once the port is open; a failed load clears the memo so the next
 * caller retries.
 */
export const loadThesaurus = (): Promise<Thesaurus> => {
  loading ??= build().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
};
