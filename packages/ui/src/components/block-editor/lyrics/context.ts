"use client";

import { createContext } from "react";

/** One word as the dictionary describes it. `estimated` marks a guess made
 * from spelling rather than a pronunciation entry, which the gutter marks
 * with a tilde and the rhyme scheme ignores. */
export type WordAnalysis = {
  word: string;
  syllables: number;
  estimated: boolean;
  rhymeKey: string | null;
  /** Keys a slant rhyme may match on — the stressed vowel and the unstressed
   * ending, each prefixed by kind. Two words rhyme slantly when their sets
   * intersect. */
  slantKeys: string[];
};

export type RhymeEntry = { word: string; syllables: number; score: number };

export type SynonymSense = { pos: string; definition: string; words: string[] };

/**
 * What the lyrics editor needs from a dictionary. The implementation lives in
 * the app that mounts the editor — this package never talks to the API.
 */
export type LyricsDictionary = {
  analyze(words: string[]): Promise<WordAnalysis[]>;
  rhymes(
    word: string,
    signal?: AbortSignal
  ): Promise<{ perfect: RhymeEntry[]; near: RhymeEntry[] }>;
  synonyms(word: string, signal?: AbortSignal): Promise<SynonymSense[]>;
};

/** The characters that open the rhyme and synonym menus while typing. Either
 * is null when its suggestion type is turned off, so its menu never opens. */
export type LyricsPrefixes = { rhyme: string | null; synonym: string | null };

/**
 * The dictionary and the prefixes that open its menus, supplied together by
 * the app that mounts the editor. With no provider the context is null: the
 * editor still edits, the gutter stays empty and no prefix opens a menu.
 */
export const LyricsContext = createContext<{
  dictionary: LyricsDictionary;
  prefixes: LyricsPrefixes;
} | null>(null);
