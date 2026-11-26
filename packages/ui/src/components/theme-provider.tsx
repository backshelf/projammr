"use client";

import { isTypingTarget } from "@workspace/ui/lib/keymap";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

/**
 * `bindThemeHotkey` is the provider's own `d` listener on `window`. An app
 * with a hotkey registry binds `d` there instead — one dispatcher, one
 * vocabulary, one place the shortcuts overlay can read — and passes `false`
 * so the key is not handled twice. An app without one (the dit app,
 * and the client's signed-out shell) leaves it on and keeps the shortcut.
 */
function ThemeProvider({
  bindThemeHotkey = true,
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider> & {
  bindThemeHotkey?: boolean;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {bindThemeHotkey ? <ThemeHotkey /> : null}
      {children}
    </NextThemesProvider>
  );
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = React.useCallback(
    () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    [resolvedTheme, setTheme]
  );
  useThemeHotkey(toggle);
  return null;
}

/**
 * Calls `toggle` when a bare `d` is pressed anywhere outside a text field:
 * the theme shortcut for an app with no hotkey registry to bind it in.
 */
function useThemeHotkey(toggle: () => void) {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "d") {
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      toggle();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);
}

export { ThemeProvider, useTheme, useThemeHotkey };
