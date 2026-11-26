/**
 * `wordpos` ships no types. This declares exactly what
 * `src/lib/thesaurus.ts` uses: the constructor and `lookup`.
 */
declare module "wordpos" {
  /** One WordNet synset, narrowed to the fields a synonym sense is built from. */
  export type Synset = { pos: string; def: string; synonyms: string[] };

  export default class WordPOS {
    constructor(options?: { stopwords?: boolean });
    /** Every synset the word belongs to, across all four parts of speech. */
    lookup(word: string): Promise<Synset[]>;
  }
}
