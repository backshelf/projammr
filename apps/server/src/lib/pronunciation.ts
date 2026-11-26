/**
 * Syllable counts, rhyme keys and rhyme candidates over the CMU Pronouncing
 * Dictionary. Everything here is pure: no Hono, no database, no network.
 *
 * The dictionary's licence notice ships in THIRD_PARTY_NOTICES.md at the repo
 * root, as its terms require.
 */
import { syllable as estimateSyllables } from "syllable";

const VOWELS = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
]);

/** One pronunciation, as ARPABET phones: `["K", "AA1", "R"]`. */
export type Phones = string[];

export type WordAnalysis = {
  word: string;
  syllables: number;
  /** True when the word is not in the dictionary and the count is a heuristic. */
  estimated: boolean;
  /** Perfect-rhyme key (stress-stripped phones from the last stressed vowel), or null when estimated. */
  rhymeKey: string | null;
  /** Keys a slant rhyme may match on; empty when estimated. See {@link slantKeys}. */
  slantKeys: string[];
};

export type Pronunciation = {
  /** Every pronunciation of a headword: `record` has two, most words have one. */
  entries: Map<string, Phones[]>;
  perfect: Map<string, string[]>;
  tail: Map<string, string[]>;
};

const isVowel = (phone: string) => VOWELS.has(phone.replace(/\d$/, ""));

const stress = (phone: string) => Number(phone.slice(-1)) || 0;

const stripStress = (phones: Phones) => phones.map((p) => p.replace(/\d$/, ""));

export const syllableCount = (phones: Phones) =>
  phones.filter((p) => /\d$/.test(p)).length;

/**
 * Where a rhyme starts: the last vowel carrying primary stress, else the last
 * carrying secondary stress, else whatever vowel comes last. -1 for a
 * pronunciation with no vowel at all.
 */
const nucleus = (phones: Phones): number => {
  const lastIndex = (pred: (phone: string) => boolean) => {
    for (let i = phones.length - 1; i >= 0; i--) if (pred(phones[i]!)) return i;
    return -1;
  };
  const primary = lastIndex((p) => isVowel(p) && stress(p) === 1);
  const secondary =
    primary >= 0 ? primary : lastIndex((p) => isVowel(p) && stress(p) === 2);
  return secondary >= 0 ? secondary : lastIndex(isVowel);
};

/**
 * The phones from the last stressed vowel to the end. `car` → "AA R",
 * `record` (verb) → "AO R D". Two words rhyme perfectly when the keys match.
 */
export const rhymeKey = (phones: Phones): string | null => {
  const start = nucleus(phones);
  return start < 0 ? null : stripStress(phones.slice(start)).join(" ");
};

/** The last vowel to the end, ignoring stress — the near-rhyme bucket. */
export const tailKey = (phones: Phones): string | null => {
  for (let i = phones.length - 1; i >= 0; i--) {
    if (isVowel(phones[i]!)) return stripStress(phones.slice(i)).join(" ");
  }
  return null;
};

/** The stressed vowel on its own: `time` → "AY", `love` → "AH". */
export const assonanceKey = (phones: Phones): string | null => {
  const i = nucleus(phones);
  return i < 0 ? null : phones[i]!.replace(/\d$/, "");
};

/**
 * The keys a slant rhyme may match on, prefixed by kind so an assonance key
 * can never collide with a tail key: assonance (`time`/`line` share their
 * stressed vowel) and the unstressed tail (`beautiful`/`cannibal` share their
 * ending but not a stressed vowel). Two words rhyme slantly when their key
 * sets intersect.
 */
export const slantKeys = (phones: Phones): string[] => {
  const assonance = assonanceKey(phones);
  const tail = tailKey(phones);
  return [
    ...(assonance ? [`v:${assonance}`] : []),
    ...(tail ? [`t:${tail}`] : []),
  ];
};

export const buildPronunciation = (
  dictionary: Record<string, string>
): Pronunciation => {
  const entries = new Map<string, Phones[]>();
  for (const [key, phoneString] of Object.entries(dictionary)) {
    const word = key.replace(/\(\d+\)$/, "");
    const variants = entries.get(word);
    if (variants) variants.push(phoneString.split(" "));
    else entries.set(word, [phoneString.split(" ")]);
  }

  const perfect = new Map<string, string[]>();
  const tail = new Map<string, string[]>();
  const add = (
    index: Map<string, string[]>,
    key: string | null,
    word: string
  ) => {
    if (!key) return;
    const bucket = index.get(key);
    if (!bucket) index.set(key, [word]);
    else if (bucket[bucket.length - 1] !== word) bucket.push(word);
  };
  for (const [word, variants] of entries) {
    // Every variant contributes its keys: `record` must rhyme with both
    // `reward` and `checkered`.
    for (const phones of variants) {
      add(perfect, rhymeKey(phones), word);
      add(tail, tailKey(phones), word);
    }
  }
  return { entries, perfect, tail };
};

let loading: Promise<Pronunciation> | undefined;

/**
 * The dictionary is a 4.5 MB object literal that costs a few hundred
 * milliseconds and tens of megabytes to index, so both the import and the
 * build wait until someone asks. `src/server.ts` warms it once the port is
 * open; a failed load clears the memo so the next caller retries.
 */
export const loadPronunciation = (): Promise<Pronunciation> => {
  loading ??= import("cmu-pronouncing-dictionary")
    .then(({ dictionary }) => buildPronunciation(dictionary))
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
};

type Entry = { headword: string; variants: Phones[] };

/**
 * Lookup ladder for text as typed in lyrics. The dictionary keeps
 * apostrophes (`don't`, `livin'`), so the verbatim form is tried before any
 * stripping; hyphenated compounds fall back to the sum of their parts.
 */
const resolve = (p: Pronunciation, raw: string): Entry | null => {
  const word = raw.toLowerCase();
  const candidates = [
    word,
    word.replace(/^[^a-z']+|[^a-z']+$/g, ""),
    word.replace(/[^a-z]/g, ""),
  ];
  for (const candidate of candidates) {
    const variants = candidate ? p.entries.get(candidate) : undefined;
    if (variants) return { headword: candidate, variants };
  }
  if (word.includes("-")) {
    const compound: Phones = [];
    for (const part of word.split("-")) {
      const entry = resolve(p, part);
      if (!entry) return null;
      compound.push(...entry.variants[0]!);
    }
    return { headword: word, variants: [compound] };
  }
  return null;
};

export const lookup = (p: Pronunciation, raw: string): Phones[] | null =>
  resolve(p, raw)?.variants ?? null;

export const analyzeWord = (p: Pronunciation, raw: string): WordAnalysis => {
  const entry = resolve(p, raw);
  if (!entry) {
    const cleaned = raw.replace(/[^A-Za-z'-]/g, "");
    return {
      word: raw,
      syllables: cleaned ? Math.max(1, estimateSyllables(cleaned)) : 0,
      estimated: true,
      rhymeKey: null,
      slantKeys: [],
    };
  }
  // The first pronunciation is the dictionary's preferred one; the gutter
  // shows a single number, and the scheme uses a single key per line.
  const preferred = entry.variants[0]!;
  return {
    word: raw,
    syllables: syllableCount(preferred),
    estimated: false,
    rhymeKey: rhymeKey(preferred),
    slantKeys: slantKeys(preferred),
  };
};

type RhymeEntry = { word: string; syllables: number; score: number };

export type RhymeResult = {
  word: string;
  syllables: number | null;
  perfect: RhymeEntry[];
  near: RhymeEntry[];
};

/** How many trailing phones two stress-stripped pronunciations share. */
const sharedSuffix = (a: Phones, b: Phones) => {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  ) {
    n++;
  }
  return n;
};

/**
 * `isCommon` is WordNet membership; it is the only commonness signal available
 * locally, and it is what keeps `bar` above `almanzar`.
 */
export const findRhymes = (
  p: Pronunciation,
  raw: string,
  isCommon: (word: string) => boolean,
  limit: number
): RhymeResult => {
  const entry = resolve(p, raw);
  if (!entry) return { word: raw, syllables: null, perfect: [], near: [] };

  const { headword, variants } = entry;
  const querySyllables = syllableCount(variants[0]!);
  const keys = (of: (phones: Phones) => string | null) =>
    new Set(variants.map(of).filter((key): key is string => key !== null));

  const rank = (a: RhymeEntry, b: RhymeEntry) =>
    b.score - a.score ||
    Number(isCommon(b.word)) - Number(isCommon(a.word)) ||
    Math.abs(a.syllables - querySyllables) -
      Math.abs(b.syllables - querySyllables) ||
    a.word.length - b.word.length ||
    a.word.localeCompare(b.word);

  // Abbreviations ("a.d.") and the query's own possessives are noise, not rhymes.
  const excluded = (word: string) =>
    word === headword || word.startsWith(`${headword}'`) || word.includes(".");

  const seen = new Set<string>();
  const collect = (
    index: Map<string, string[]>,
    from: Set<string>,
    score: (phones: Phones) => number
  ) => {
    const found: RhymeEntry[] = [];
    for (const key of from) {
      for (const word of index.get(key) ?? []) {
        if (excluded(word) || seen.has(word)) continue;
        seen.add(word);
        const phones = p.entries.get(word)![0]!;
        found.push({
          word,
          syllables: syllableCount(phones),
          score: score(phones),
        });
      }
    }
    return found.sort(rank);
  };

  // Perfect rhymes all tie on score, so commonness decides. Near rhymes are the
  // tail bucket minus the perfect set, scored by how much of the ending they
  // actually share.
  const perfect = collect(p.perfect, keys(rhymeKey), () => 0);
  const stripped = variants.map(stripStress);
  const near = collect(p.tail, keys(tailKey), (phones) => {
    const other = stripStress(phones);
    return Math.max(...stripped.map((v) => sharedSuffix(v, other)));
  });

  return {
    word: raw,
    syllables: querySyllables,
    perfect: perfect.slice(0, limit),
    near: near.slice(0, limit),
  };
};
