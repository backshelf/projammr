import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import { describer, respond, validator } from "../lib/http.js";
import {
  analyzeWord,
  findRhymes,
  loadPronunciation,
} from "../lib/pronunciation.js";
import { loadThesaurus } from "../lib/thesaurus.js";

const { describe } = describer("Lyrics");

const app = new Hono<AuthedEnv>();

const wordAnalysisSchema = z.object({
  word: z.string(),
  syllables: z.number().int(),
  estimated: z.boolean(),
  rhymeKey: z.string().nullable(),
  slantKeys: z.array(z.string()),
});

const rhymeEntrySchema = z.object({
  word: z.string(),
  syllables: z.number().int(),
  score: z.number(),
});

const rhymeResultSchema = z.object({
  word: z.string(),
  syllables: z.number().int().nullable(),
  perfect: z.array(rhymeEntrySchema),
  near: z.array(rhymeEntrySchema),
});

const synonymSenseSchema = z.object({
  pos: z.enum(["noun", "verb", "adjective", "adverb"]),
  definition: z.string(),
  words: z.array(z.string()),
});

const synonymResultSchema = z.object({
  word: z.string(),
  senses: z.array(synonymSenseSchema),
});

const analyzeBodySchema = z.object({
  words: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
});

const analyzeResultSchema = z.object({ words: z.array(wordAnalysisSchema) });

const wordQuery = z.string().trim().min(1).max(64);

const rhymesQuerySchema = z.object({
  word: wordQuery,
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const synonymsQuerySchema = z.object({
  word: wordQuery,
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

/** The dictionary is immutable at runtime, so a client can cache an answer indefinitely. */
const DICTIONARY_CACHE_CONTROL = "private, max-age=86400";

app.post(
  "/analyze",
  describe(
    "Analyse a batch of words. Syllable counts and rhyme-scheme keys, in the order the words were sent.",
    { schema: analyzeResultSchema, description: "Analysis for each word" },
    400
  ),
  validator("json", analyzeBodySchema),
  async (c) => {
    const { words } = c.req.valid("json");
    const pronunciation = await loadPronunciation();
    return respond(c, analyzeResultSchema, {
      words: words.map((word) => analyzeWord(pronunciation, word)),
    });
  }
);

app.get(
  "/rhymes",
  describe(
    "Rhymes for a word. Perfect and near rhymes, ranked by commonness and syllable proximity.",
    { schema: rhymeResultSchema, description: "Rhyme candidates" },
    400
  ),
  validator("query", rhymesQuerySchema),
  async (c) => {
    const { word, limit } = c.req.valid("query");
    const [pronunciation, thesaurus] = await Promise.all([
      loadPronunciation(),
      loadThesaurus(),
    ]);
    c.header("Cache-Control", DICTIONARY_CACHE_CONTROL);
    return respond(
      c,
      rhymeResultSchema,
      findRhymes(pronunciation, word, thesaurus.isCommon, limit)
    );
  }
);

app.get(
  "/synonyms",
  describe(
    "Synonym senses for a word from WordNet.",
    { schema: synonymResultSchema, description: "Synonym senses" },
    400
  ),
  validator("query", synonymsQuerySchema),
  async (c) => {
    const { word, limit } = c.req.valid("query");
    const thesaurus = await loadThesaurus();
    c.header("Cache-Control", DICTIONARY_CACHE_CONTROL);
    return respond(
      c,
      synonymResultSchema,
      await thesaurus.lookupSynonyms(word, limit)
    );
  }
);

export default app;
