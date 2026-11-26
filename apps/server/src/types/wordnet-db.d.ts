/**
 * `wordnet-db` ships no types. This declares exactly what
 * `src/lib/thesaurus.ts` uses: the directory holding the WordNet files.
 */
declare module "wordnet-db" {
  const db: { version: string; path: string; files: string[] };
  export default db;
}
