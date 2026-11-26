import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";

/**
 * A trigger prefix in the lyrics editor. BlockNote accepts multi-character
 * triggers, and four characters is enough for any of them while stopping a
 * whole sentence from becoming one.
 */
const prefix = z.string().min(1).max(4);

export const group = defineGroup({
  id: "editor",
  section: "personal",
  label: "Editor",
  description: "How the editor behaves while you write.",
  order: 50,
});

export const settings = [
  defineSetting({
    key: "editor.rhymePrefix",
    group: "editor",
    label: "Rhyme prefix",
    description:
      "The characters that open the rhyme menu while writing lyrics.",
    keywords: ["lyrics", "rhyme", "trigger", "suggestions"],
    scopes: ["user", "instance"],
    schema: prefix,
    default: "\\",
    control: { kind: "text" },
    audience: "all",
  }),
  defineSetting({
    key: "editor.synonymPrefix",
    group: "editor",
    label: "Synonym prefix",
    description:
      "The characters that open the synonym menu while writing lyrics.",
    keywords: ["lyrics", "synonym", "thesaurus", "trigger", "suggestions"],
    scopes: ["user", "instance"],
    schema: prefix,
    default: "~",
    control: { kind: "text" },
    audience: "all",
  }),
  defineSetting({
    key: "editor.rhymeSuggestions",
    group: "editor",
    label: "Rhyme suggestions",
    description:
      "The rhyme prefix opens a menu of rhymes while writing lyrics.",
    keywords: ["lyrics", "rhyme", "suggestions", "menu"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "editor.synonymSuggestions",
    group: "editor",
    label: "Synonym suggestions",
    description:
      "The synonym prefix opens a menu of synonyms while writing lyrics.",
    keywords: ["lyrics", "synonym", "thesaurus", "suggestions", "menu"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "editor.newNoteMode",
    group: "editor",
    label: "New notes start as",
    description: "Whether a new note opens as lyrics or as plain notes.",
    keywords: ["note", "lyrics", "plain", "new"],
    scopes: ["user", "instance"],
    schema: z.enum(["lyrics", "plain"]),
    default: "lyrics",
    control: {
      kind: "select",
      options: [
        { value: "lyrics", label: "Lyrics" },
        { value: "plain", label: "Plain notes" },
      ],
    },
    audience: "all",
  }),
  defineSetting({
    key: "editor.syllableCounts",
    group: "editor",
    label: "Syllable counts",
    description: "Each lyric line's syllable count in the gutter.",
    keywords: ["lyrics", "syllables", "gutter", "count"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
    document: {
      attribute: "data-lyrics-syllables",
      value: (shown) => (shown ? null : "off"),
    },
  }),
  defineSetting({
    key: "editor.rhymeLetters",
    group: "editor",
    label: "Rhyme letters",
    description: "Each lyric line's rhyme letter in the gutter.",
    keywords: ["lyrics", "rhyme", "scheme", "gutter"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    audience: "all",
    document: {
      attribute: "data-lyrics-rhymes",
      value: (shown) => (shown ? null : "off"),
    },
  }),
];
