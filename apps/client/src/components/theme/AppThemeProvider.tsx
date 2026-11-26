"use client";

import {
  useSetting,
  useSettingsUserId,
  useUserSettingsWrite,
} from "@/lib/settings/provider";
import { toastRefusedWrite } from "@/lib/settings/refusal";
import {
  DARK_SCHEME_QUERY,
  explicitTheme,
  storedTheme,
  storeTheme,
  type ResolvedTheme,
} from "@/lib/theme/script";
import type { Theme } from "@workspace/settings/appearance";
import { useThemeHotkey } from "@workspace/ui/components/theme-provider";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export type ThemeState = {
  /** The viewer's choice: signed in, their saved one; signed out, the page's. */
  theme: Theme;
  /**
   * The scheme on `<html>`. For a `system` theme it is `undefined` until the
   * browser has answered, through the server render and hydration, while the
   * head script's class stands.
   */
  resolvedTheme: ResolvedTheme | undefined;
  /**
   * Signed in, saves the viewer's `appearance.theme` and toasts a refusal
   * (the settings store puts the old theme back). Signed out, holds the
   * theme until the page is reloaded; nothing is saved.
   */
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

function subscribeScheme(onChange: () => void) {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function browserScheme(): ResolvedTheme {
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

/** The server cannot know the OS scheme or the kept theme; neither can hydration. */
const serverScheme = () => null;

/** Another tab's `storeTheme` shows up here; this tab's own never needs to. */
function subscribeKept(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const OPPOSITE: Record<ResolvedTheme, ResolvedTheme> = {
  light: "dark",
  dark: "light",
};

/**
 * Holds every transition off while a switch lands, so the page changes
 * scheme at once rather than each colour easing at its own pace. Returns the
 * function that lets them run again.
 */
function suspendTransitions(): () => void {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(style);
  return () => {
    // Reading a computed style applies the switch while the rule still holds.
    window.getComputedStyle(document.body).getPropertyValue("opacity");
    setTimeout(() => style.remove(), 1);
  };
}

function applyTheme(resolved: ResolvedTheme) {
  const { classList } = document.documentElement;
  const opposite = OPPOSITE[resolved];
  if (classList.contains(resolved) && !classList.contains(opposite)) return;
  const resumeTransitions = suspendTransitions();
  classList.remove(opposite);
  classList.add(resolved);
  resumeTransitions();
}

function ThemeHotkey({ toggle }: { toggle: () => void }) {
  useThemeHotkey(toggle);
  return null;
}

/**
 * Keeps `<html>`'s `light` or `dark` class on the viewer's theme after the
 * first paint, which the server's class and the head script
 * (`lib/theme/script.ts`) cover. Sits inside the root `SettingsProvider`.
 *
 * `bindThemeHotkey` is its own `d` listener, for a shell with no hotkey
 * registry to bind the key in.
 */
export function AppThemeProvider({
  bindThemeHotkey,
  children,
}: {
  bindThemeHotkey: boolean;
  children: ReactNode;
}) {
  const saved = useSetting("appearance.theme");
  const userId = useSettingsUserId();
  const write = useUserSettingsWrite();
  const [pageTheme, setPageTheme] = useState<Theme | null>(null);
  const theme = userId === null ? (pageTheme ?? saved) : saved;
  const scheme = useSyncExternalStore(
    subscribeScheme,
    browserScheme,
    serverScheme
  );
  const kept = useSyncExternalStore(subscribeKept, storedTheme, serverScheme);
  // A signed-out page has no theme of its own to follow: for `system` it
  // takes the one the member kept, as `THEME_SCRIPT` did before paint. A
  // member's saved theme is authoritative, and their `system` follows the OS.
  const resolvedTheme =
    explicitTheme(theme) ??
    (userId === null ? kept : null) ??
    scheme ??
    undefined;

  // After every commit, not only when the theme changes: a route refresh
  // re-renders the root layout's `<html className>`, which writes the whole
  // class list and drops a `system` theme's class. React applies that write
  // before it runs this commit's layout effects, so the class is back before
  // the browser paints.
  useLayoutEffect(() => {
    if (resolvedTheme) applyTheme(resolvedTheme);
  });

  // Only a signed-in viewer's choice is kept: a signed-out page renders from
  // the instance's theme, and the offline page, which is one, must not
  // overwrite what the viewer last chose.
  useEffect(() => {
    if (userId !== null) storeTheme(theme);
  }, [userId, theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (userId === null) setPageTheme(next);
      else write({ "appearance.theme": next }).catch(toastRefusedWrite);
    },
    [userId, write]
  );

  const toggle = useCallback(
    () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    [resolvedTheme, setTheme]
  );

  const state = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return (
    <ThemeContext value={state}>
      {bindThemeHotkey ? <ThemeHotkey toggle={toggle} /> : null}
      {children}
    </ThemeContext>
  );
}

/** The viewer's theme; see `ThemeState`. */
export function useTheme(): ThemeState {
  const state = use(ThemeContext);
  if (!state) {
    throw new Error("useTheme is only available inside AppThemeProvider");
  }
  return state;
}
