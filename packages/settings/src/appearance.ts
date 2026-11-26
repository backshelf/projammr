/**
 * The appearance preferences the document carries as attributes on `<html>`,
 * one attribute per preference. The token layer (`foundation.css`,
 * `atmosphere.css`, `doc.css`, `motion.css`) turns each value into tokens, so
 * a value rendered on the first byte restyles the whole room with no script.
 *
 * `default` is the value that renders exactly as a document with no attribute
 * at all: it has no rule of its own, so setting it and leaving the attribute
 * off are the same page.
 *
 * Plain data with no imports, so the settings registry and `@workspace/ui`'s
 * hooks read one list, and a bundler reaching it through `@workspace/ui`
 * resolves nothing further.
 */
export const APPEARANCE = {
  density: {
    attribute: "data-density",
    values: ["compact", "comfortable", "spacious"],
    default: "comfortable",
  },
  text: {
    attribute: "data-text",
    values: ["sm", "md", "lg", "xl"],
    default: "md",
  },
  grain: {
    attribute: "data-grain",
    values: ["off", "subtle", "full"],
    default: "full",
  },
  glow: {
    attribute: "data-glow",
    values: ["off", "soft", "full"],
    default: "full",
  },
  ambient: {
    attribute: "data-ambient",
    values: ["on", "off"],
    default: "on",
  },
  motion: {
    attribute: "data-motion",
    values: ["system", "reduce", "full"],
    default: "system",
  },
  radius: {
    attribute: "data-radius",
    values: ["none", "sm", "md", "lg"],
    default: "md",
  },
  width: {
    attribute: "data-width",
    values: ["narrow", "wide"],
    default: "narrow",
  },
  masthead: {
    attribute: "data-masthead",
    values: ["tall", "short"],
    default: "tall",
  },
  font: {
    attribute: "data-font",
    values: ["mono", "sans", "serif"],
    default: "mono",
  },
  editor: {
    attribute: "data-editor",
    values: ["compact", "reading"],
    default: "compact",
  },
} as const satisfies Record<
  string,
  {
    attribute: `data-${string}`;
    values: readonly [string, ...string[]];
    default: string;
  }
>;

export type AppearanceKey = keyof typeof APPEARANCE;

export type AppearanceValue<K extends AppearanceKey> =
  (typeof APPEARANCE)[K]["values"][number];

/**
 * The inline custom property on `<html>` that carries the accent for pages
 * with no artwork: any CSS colour. The token layer fixes its lightness per
 * theme the way it does an extracted cover's (`ACCENT_TONES` in `art.ts`), and
 * an artwork accent set inline further down always wins over it.
 */
export const ART_FALLBACK_PROPERTY = "--art-fallback";

/**
 * The colour schemes a viewer can pick; `system` follows the OS. The chosen
 * one is `data-theme` on `<html>`, and the scheme it resolves to is the
 * `light` or `dark` class there.
 */
export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_ATTRIBUTE = "data-theme";
