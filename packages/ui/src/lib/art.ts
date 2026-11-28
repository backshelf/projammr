import type { CSSProperties } from "react";

/**
 * The accent channel a page exposes to CSS. Both themes are emitted because an
 * inline style cannot carry a media query; rules in `globals.css` resolve
 * `--art`/`--art-glow` from the `-light` pair by default and the `-dark` pair
 * under `.dark`. The resolved names are deliberately *not* set inline — an
 * inline `--art` would outweigh those rules and pin the accent to one theme.
 */
export type ArtVars = CSSProperties & {
  "--art-light": string;
  "--art-glow-light": string;
  "--art-dark": string;
  "--art-glow-dark": string;
  "--art-image": string;
};

/**
 * The accent for a page with no artwork: the grayscale fallbacks, matching
 * the server's `GRAYSCALE` palette, unless the document carries an accent for
 * such pages (`--art-fallback`), which the stylesheet resolves per theme into
 * the four `--art-fallback-*` tokens read here.
 */
const NEUTRAL = {
  art: "var(--art-fallback-light, oklch(0.45 0 0))",
  glow: "var(--art-fallback-glow-light, oklch(0.65 0 0))",
  artDark: "var(--art-fallback-dark, oklch(0.8 0 0))",
  glowDark: "var(--art-fallback-glow-dark, oklch(0.38 0 0))",
};

/**
 * The lightness and chroma an accent takes in each role and theme, whatever
 * its source. The lightness is fixed so every page renders the same contrast
 * whatever the cover looked like, and chroma is scaled and capped for the same
 * reason — a saturated cover would otherwise put a vivid accent against
 * paper. The stylesheet makes the `--art-fallback` accent from the same
 * numbers (foundation.css), and `appearance.test.ts` holds it to them.
 */
export const ACCENT_TONES = {
  art: { lightness: 0.5, chromaScale: 1.3, maxChroma: 0.19 },
  glow: { lightness: 0.72, chromaScale: 1, maxChroma: 0.14 },
  artDark: { lightness: 0.78, chromaScale: 1.25, maxChroma: 0.17 },
  glowDark: { lightness: 0.45, chromaScale: 1, maxChroma: 0.14 },
} as const;

/** The extractor stores a bare hue and chroma on the image row; each role
 *  takes its lightness and its chroma cap from {@link ACCENT_TONES}. */
function accentFromHue(hue: number, chroma: number) {
  const h = hue.toFixed(1);
  const tone = ({ lightness, chromaScale, maxChroma }: AccentTone) =>
    `oklch(${lightness} ${Math.min(chroma * chromaScale, maxChroma).toFixed(3)} ${h})`;
  return {
    art: tone(ACCENT_TONES.art),
    glow: tone(ACCENT_TONES.glow),
    artDark: tone(ACCENT_TONES.artDark),
    glowDark: tone(ACCENT_TONES.glowDark),
  };
}

type AccentTone = (typeof ACCENT_TONES)[keyof typeof ACCENT_TONES];

/**
 * The accent channel for a bare hue + chroma pair (an `images` row's
 * `accentHue`/`accentChroma`), with the grayscale fallback when the hue is
 * null, and the cover's URL as `--art-image` when there is one. The pair is
 * all a page needs to take a cover's colour, so the music player (which
 * carries the playing track's accent, not an image row) and a static page lit
 * by a known cover build on it as the client's artwork mapping does.
 */
export function artVarsFromAccent(
  hue: number | null | undefined,
  chroma: number | null | undefined,
  image?: string | null
): ArtVars {
  const accent = hue != null ? accentFromHue(hue, chroma ?? 0) : NEUTRAL;

  return {
    "--art-light": accent.art,
    "--art-glow-light": accent.glow,
    "--art-dark": accent.artDark,
    "--art-glow-dark": accent.glowDark,
    "--art-image": image ? `url("${image}")` : "none",
  };
}
