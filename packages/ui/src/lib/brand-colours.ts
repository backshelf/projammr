/* The client's manifest, theme-colour meta and generated icons, and the
   marketing site's favicon, are read before any stylesheet loads, so the token
   layer cannot reach them. These are the only colour literals outside the
   stylesheet; each is the value of a spine token in `styles/foundation.css`. */

/** `--paper` in the light theme (`oklch(0.995 0 0)`), which converts exactly. */
export const PAPER_LIGHT = "#fdfdfd";

/** `--paper` in the dark theme (`oklch(0.135 0 0)`), which converts exactly. */
export const PAPER_DARK = "#080808";

/** `--ink` in the light theme, for the mark on the generated icon. */
export const INK = "#171717";

/** `--ink` in the dark theme (`oklch(0.99 0 0)`), which converts exactly. */
export const INK_DARK = "#fcfcfc";
