import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

export const COMMAND_BAR_POSITIONS = ["bottom", "top"] as const;
export type CommandBarPosition = (typeof COMMAND_BAR_POSITIONS)[number];

export const COMMAND_BAR_MODES = ["always", "pending"] as const;
export type CommandBarMode = (typeof COMMAND_BAR_MODES)[number];

export const group = defineGroup({
  id: "commands",
  section: "personal",
  label: "Command bar",
  description: "The desktop command bar: whether it shows, and where.",
  order: 85,
});

export const settings = [
  defineSetting({
    key: "commands.barEnabled",
    group: "commands",
    label: "Show the command bar",
    description: "A bar of the keys and the “:” prompt, on desktop only.",
    keywords: ["command", "bar", "keys", "shortcuts", "prompt"],
    scopes: ["user", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "all",
  }),
  defineSetting({
    key: "commands.barPosition",
    group: "commands",
    label: "Bar position",
    description: "Where the command bar sits on desktop.",
    keywords: ["command", "bar", "position", "top", "bottom"],
    scopes: ["user", "instance"],
    schema: z.enum(COMMAND_BAR_POSITIONS),
    default: "bottom",
    control: {
      kind: "select",
      options: optionsOf({ bottom: "Bottom", top: "Top" }),
    },
    audience: "all",
  }),
  defineSetting({
    key: "commands.barMode",
    group: "commands",
    label: "Bar mode",
    description:
      "“Always” keeps the bar showing on desktop. “Only while pending” shows it only while a chord, a count or the “:” prompt is pending.",
    keywords: ["command", "bar", "mode", "pending"],
    scopes: ["user", "instance"],
    schema: z.enum(COMMAND_BAR_MODES),
    default: "always",
    control: {
      kind: "select",
      options: optionsOf({
        always: "Always",
        pending: "Only while pending",
      }),
    },
    audience: "all",
  }),
];
