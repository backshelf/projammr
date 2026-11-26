import { z } from "zod";
import {
  APPEARANCE,
  ART_FALLBACK_PROPERTY,
  THEME_ATTRIBUTE,
  THEMES,
} from "../appearance.js";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

export const group = defineGroup({
  id: "appearance",
  section: "personal",
  label: "Appearance",
  description: "How the room looks: theme, type, space and atmosphere.",
  order: 10,
});

/**
 * One `APPEARANCE` preference as a setting, less its key: its values and
 * default from the list, and the attribute it names, left off at the default
 * (which has no rule of its own).
 */
function fromAppearance<const V extends string>(
  entry: {
    readonly attribute: string;
    readonly values: readonly [V, ...V[]];
    readonly default: NoInfer<V>;
  },
  meta: {
    label: string;
    description: string;
    keywords: readonly string[];
    labels: Readonly<Record<V, string>>;
  }
) {
  return {
    group: "appearance",
    label: meta.label,
    description: meta.description,
    keywords: meta.keywords,
    scopes: ["user", "instance"],
    schema: z.enum(entry.values),
    default: entry.default,
    control: { kind: "select", options: optionsOf(meta.labels) },
    audience: "public",
    document: {
      attribute: entry.attribute,
      value: (value: V) => (value === entry.default ? null : value),
    },
  } as const;
}

/** Hex, as the colour control writes it, or empty for no fallback accent. */
const accent = z.union([
  z.literal(""),
  z.string().regex(/^#[0-9a-f]{6}$/i, "A colour is written #rrggbb."),
]);

export const settings = [
  defineSetting({
    key: "appearance.theme",
    group: "appearance",
    label: "Theme",
    description: "Light, dark, or whichever your system is using.",
    keywords: ["dark mode", "light mode", "colour scheme", "night"],
    scopes: ["user", "instance"],
    schema: z.enum(THEMES),
    default: "system",
    control: {
      kind: "select",
      options: optionsOf({ light: "Light", dark: "Dark", system: "System" }),
    },
    audience: "public",
    document: { attribute: THEME_ATTRIBUTE, value: (value) => value },
  }),
  defineSetting({
    key: "appearance.motion",
    ...fromAppearance(APPEARANCE.motion, {
      label: "Motion",
      description:
        "Follow your system's reduced-motion preference, always reduce, or always move.",
      keywords: ["animation", "reduced motion", "accessibility"],
      labels: { system: "System", reduce: "Reduce", full: "Full" },
    }),
  }),
  defineSetting({
    key: "appearance.ambient",
    ...fromAppearance(APPEARANCE.ambient, {
      label: "Ambient motion",
      description:
        "Whether the colour field behind a page drifts on its own. Off stops the drift and nothing else.",
      keywords: ["drift", "background", "animation", "field"],
      labels: { on: "On", off: "Off" },
    }),
  }),
  defineSetting({
    key: "appearance.grain",
    ...fromAppearance(APPEARANCE.grain, {
      label: "Grain",
      description: "The film grain laid over every page.",
      keywords: ["noise", "texture", "film"],
      labels: { off: "Off", subtle: "Subtle", full: "Full" },
    }),
  }),
  defineSetting({
    key: "appearance.glow",
    ...fromAppearance(APPEARANCE.glow, {
      label: "Glow",
      description:
        "How strongly artwork colours the masthead and the wash behind a page.",
      keywords: ["artwork", "colour", "wash", "masthead"],
      labels: { off: "Off", soft: "Soft", full: "Full" },
    }),
  }),
  defineSetting({
    key: "appearance.masthead",
    ...fromAppearance(APPEARANCE.masthead, {
      label: "Masthead",
      description:
        "How much of the screen an entity page's artwork band takes.",
      keywords: ["header", "artwork", "banner", "height"],
      labels: { tall: "Tall", short: "Short" },
    }),
  }),
  defineSetting({
    key: "appearance.text",
    ...fromAppearance(APPEARANCE.text, {
      label: "Text size",
      description: "The size of body text, with headings scaled to match.",
      keywords: ["font size", "zoom", "type", "accessibility"],
      labels: { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" },
    }),
  }),
  defineSetting({
    key: "appearance.font",
    ...fromAppearance(APPEARANCE.font, {
      label: "Body font",
      description:
        "The face of body text and notes. Labels and titles keep their own.",
      keywords: ["typeface", "mono", "sans", "serif"],
      labels: { mono: "Mono", sans: "Sans", serif: "Serif" },
    }),
  }),
  defineSetting({
    key: "appearance.accentFallback",
    group: "appearance",
    label: "Accent",
    description:
      "The colour a page without artwork takes. Artwork always wins where there is some.",
    keywords: ["colour", "tint", "accent", "artwork"],
    scopes: ["user", "project", "instance"],
    schema: accent,
    default: "",
    control: { kind: "colour" },
    audience: "public",
    document: {
      property: ART_FALLBACK_PROPERTY,
      value: (value) => (value === "" ? null : value),
    },
  }),
  defineSetting({
    key: "appearance.width",
    ...fromAppearance(APPEARANCE.width, {
      label: "Page width",
      description: "How wide a page's column runs on a large screen.",
      keywords: ["column", "layout", "wide", "narrow"],
      labels: { narrow: "Narrow", wide: "Wide" },
    }),
  }),
  defineSetting({
    key: "appearance.density",
    ...fromAppearance(APPEARANCE.density, {
      label: "Density",
      description: "How much room a table row and a list row take.",
      keywords: ["compact", "spacing", "rows", "padding"],
      labels: {
        compact: "Compact",
        comfortable: "Comfortable",
        spacious: "Spacious",
      },
    }),
  }),
  defineSetting({
    key: "appearance.radius",
    ...fromAppearance(APPEARANCE.radius, {
      label: "Corners",
      description: "How round buttons, fields and panels are.",
      keywords: ["radius", "rounded", "square"],
      labels: { none: "Square", sm: "Small", md: "Medium", lg: "Large" },
    }),
  }),
  defineSetting({
    key: "appearance.editor",
    ...fromAppearance(APPEARANCE.editor, {
      label: "Editor type",
      description:
        "Notes and lyrics in the compact face, or larger with more space between lines.",
      keywords: ["notes", "lyrics", "reading", "typography"],
      labels: { compact: "Compact", reading: "Reading" },
    }),
  }),
];
