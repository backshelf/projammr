/**
 * Readable ink for text drawn on a user-picked colour.
 *
 * The colour comes from the user (a status, a label), so nothing about it is
 * known ahead of time and the app's own ink cannot be used: `--ink` follows the
 * light/dark theme, and a status that happens to sit near the theme's ink
 * renders invisible against it. The two values returned here are fixed instead,
 * so the contrast holds in either theme — what has to contrast is the fill
 * behind the text, not the page around it.
 */
const INK_ON_LIGHT = "oklch(0.09 0 0)";
const INK_ON_DARK = "oklch(0.99 0 0)";

/**
 * The relative luminance above which a fill is light enough to take dark text.
 * 0.179 is the crossover for the WCAG contrast formula: it is the point where
 * a fill contrasts equally with black and with white.
 */
const LIGHT_FILL_THRESHOLD = 0.179;

/**
 * Picks black or white ink for `inputColour`, whichever contrasts with it.
 *
 * Deliberately takes no theme: the ink has to answer the fill it sits on, and
 * that fill is the same colour in both themes.
 */
export function getContrastColour(inputColour: string) {
  const luminance = computeLuminence(inputColour);

  // An unparseable colour tells us nothing about what will contrast with it.
  // The fills these sit on are mid-toned by default, so dark ink is the safer
  // guess, and it matches what a null colour falls back to elsewhere.
  if (luminance === null) return INK_ON_LIGHT;

  return luminance > LIGHT_FILL_THRESHOLD ? INK_ON_LIGHT : INK_ON_DARK;
}

/** WCAG relative luminance, 0–1. Null when the colour cannot be parsed. */
function computeLuminence(backgroundcolor: string): number | null {
  const colours = hexToRgb(backgroundcolor);

  if (!colours) return null;

  const linear = ([] as number[]).concat(
    [colours.r, colours.g, colours.b].map((value) => {
      const channel = value / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    })
  );

  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/**
 * Parses `#RGB`, `#RRGGBB` and `#RRGGBBAA` (with or without the hash). Alpha is
 * accepted because the colour column allows it, and ignored: the swatch is
 * painted over an opaque surface, so the blend is close enough to the fill for
 * the ink choice, and a colour we could parse is better than one we reject.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const digits = hex.trim().replace(/^#/, "");

  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;

  if (!/^[a-f\d]{6}([a-f\d]{2})?$/i.test(expanded)) return null;

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}
