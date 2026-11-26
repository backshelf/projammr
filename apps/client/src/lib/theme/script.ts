import { THEME_ATTRIBUTE, type Theme } from "@workspace/settings/appearance";

/** The colour scheme a theme puts on `<html>` as a class. */
export type ResolvedTheme = Exclude<Theme, "system">;

/** Matches when the OS asks for dark; a `system` theme follows it. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const SYSTEM = "system" satisfies Theme;
const DARK = "dark" satisfies ResolvedTheme;
const LIGHT = "light" satisfies ResolvedTheme;

/** The class a theme names by itself; a `system` one needs the OS's answer. */
export function explicitTheme(theme: Theme): ResolvedTheme | undefined {
  return theme === SYSTEM ? undefined : theme;
}

/**
 * Where a signed-in viewer's theme is kept for the pages that render without
 * their session, the precached offline page above all.
 */
export const THEME_STORAGE_KEY = "pj-theme";

/** Keeps the viewer's theme for `THEME_SCRIPT`; storage that refuses is skipped. */
export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or a full quota: the script falls back to the OS scheme.
  }
}

/**
 * The `light` or `dark` theme `storeTheme` last kept, or `null` when none is
 * or storage refuses. `THEME_SCRIPT` applies the same rule in the page.
 */
export function storedTheme(): ResolvedTheme | null {
  try {
    const kept = localStorage.getItem(THEME_STORAGE_KEY);
    return kept === DARK || kept === LIGHT ? kept : null;
  } catch {
    return null;
  }
}

/**
 * Marks an `<html>` the root layout rendered without a session. Only such a
 * page takes the kept theme for `system`; a signed-in viewer's `system`
 * follows the OS, as `AppThemeProvider` does after hydration.
 */
export const SIGNED_OUT_ATTRIBUTE = "data-signed-out";

/**
 * The root layout's inline `<head>` script, run before the first paint. An
 * explicit theme is already in the server's `<html>` class; a `system` one
 * cannot be, since only the browser knows the viewer's scheme, so this adds
 * the class of the theme `storeTheme` last kept when the page is signed out
 * and that is `light` or `dark`, and otherwise the one `matchMedia` asks for.
 * It is a constant, so the content security policy allows it by its hash
 * (`next.config.ts`), and this module imports nothing from React or Next so
 * the config can load it.
 */
export const THEME_SCRIPT = `(function(){var root=document.documentElement;if(root.getAttribute(${JSON.stringify(THEME_ATTRIBUTE)})===${JSON.stringify(SYSTEM)}){var saved;if(root.hasAttribute(${JSON.stringify(SIGNED_OUT_ATTRIBUTE)})){try{saved=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}}root.classList.add(saved===${JSON.stringify(DARK)}||saved===${JSON.stringify(LIGHT)}?saved:matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches?${JSON.stringify(DARK)}:${JSON.stringify(LIGHT)})}})()`;
