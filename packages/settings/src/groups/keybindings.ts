import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { parseCombo } from "../keymap.js";

/** A key combo in its canonical form, the only one a capture emits and a stored value compares as. */
export const comboSchema = z
  .string()
  .refine(
    (combo) => parseCombo(combo) === combo,
    "A key combo must be in its canonical form."
  );

/** Client commands that must keep a key. */
export const RESERVED_CLIENT_COMMANDS = [
  "keyboard-shortcuts",
  "command-palette",
] as const;

/** Client commands whose keys follow another command's override; they are not listed on their own. */
export const LINKED_CLIENT_COMMANDS = {
  "close-keyboard-shortcuts": "keyboard-shortcuts",
} as const;

const overrides = z.record(
  z.string().min(1).max(64),
  z.array(comboSchema).max(4)
);

export const group = defineGroup({
  id: "keybindings",
  section: "personal",
  label: "Keyboard shortcuts",
  description: "The keys that run commands in the app.",
  order: 87,
});

export const settings = [
  defineSetting({
    key: "keybindings.client",
    group: "keybindings",
    label: "App shortcuts",
    description:
      "Your own keys for the app's commands. A command with no entry keeps its default keys.",
    keywords: ["keyboard", "shortcut", "hotkey", "keys", "bind"],
    scopes: ["user", "instance"],
    schema: overrides,
    default: {},
    control: { kind: "custom", component: "keybinding-map" },
    audience: "all",
  }),
];
