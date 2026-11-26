import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { allShown, arrangedList, optionsOf } from "../options.js";

/** What an empty palette query offers, in the order it has always offered it. */
export const PALETTE_EMPTY_GROUPS = [
  "actions",
  "recent-tracks",
  "recent-sessions",
] as const;

/** The ids of the palette's prefix commands, the values an alias may open. */
export const PALETTE_PREFIX_COMMANDS = [
  "play",
  "queue",
  "playnext",
  "go",
  "note",
  "theme",
  "volume",
  "speed",
  "pitch",
  "lab",
  "seek",
  "new-track-titled",
  "new-session-named",
  "filter",
  "status",
  "priority",
  "set-field",
  "label",
  "unlabel",
] as const;

export type PalettePrefixCommand = (typeof PALETTE_PREFIX_COMMANDS)[number];

export const group = defineGroup({
  id: "palette",
  section: "personal",
  label: "Command palette",
  description: "What the palette offers and the words that open its commands.",
  order: 80,
});

export const settings = [
  defineSetting({
    key: "palette.resultCap",
    group: "palette",
    label: "Results per command",
    description:
      "How many rows a prefix command such as “track” lists at most.",
    keywords: ["palette", "results", "limit", "search"],
    scopes: ["user", "instance"],
    schema: z.number().int().min(1).max(50),
    default: 5,
    control: { kind: "number", min: 1, max: 50, step: 1 },
    audience: "all",
  }),
  defineSetting({
    key: "palette.aliases",
    group: "palette",
    label: "Command words",
    description:
      "Your own words for the palette's prefix commands. A command's own word always wins.",
    keywords: ["alias", "shortcut", "prefix", "palette"],
    scopes: ["user", "instance"],
    schema: z.record(
      z.string().min(1).max(24).regex(/^\S+$/, "A word has no spaces."),
      z.enum(PALETTE_PREFIX_COMMANDS)
    ),
    default: {},
    control: { kind: "custom", component: "palette-aliases" },
    audience: "all",
  }),
  defineSetting({
    key: "palette.emptyGroups",
    group: "palette",
    label: "Before you type",
    description: "What the palette lists before you type, in what order.",
    keywords: ["palette", "empty", "recent", "actions"],
    scopes: ["user", "instance"],
    schema: arrangedList(
      z.object({ id: z.enum(PALETTE_EMPTY_GROUPS), shown: z.boolean() })
    ),
    default: allShown(PALETTE_EMPTY_GROUPS),
    control: {
      kind: "custom",
      component: "ordered-list",
      options: optionsOf({
        actions: "Actions",
        "recent-tracks": "Recent tracks",
        "recent-sessions": "Recent sessions",
      }),
    },
    audience: "all",
  }),
];
