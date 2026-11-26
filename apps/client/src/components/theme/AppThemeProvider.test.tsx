import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Theme } from "@workspace/settings/appearance";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { createRoot } from "react-dom/client";
import { THEME_STORAGE_KEY } from "@/lib/theme/script";
import { stubColorScheme } from "@/lib/theme/test-support";

let saved: Theme = "system";
let userId: string | null = "member-1";
const write = mock<(patch: Record<string, unknown>) => Promise<unknown>>(() =>
  Promise.resolve({})
);
const toastRefusedWrite = mock<(failure: unknown) => void>(() => {});

const savedStub = () => saved;
const userIdStub = () => userId;
const writeStub = () => write;
mock.module("@/lib/settings/provider", () => ({
  useSetting: savedStub,
  useSettingsUserId: userIdStub,
  useUserSettingsWrite: writeStub,
}));
mock.module("@/lib/settings/refusal", () => ({ toastRefusedWrite }));

const { AppThemeProvider, useTheme } = await import("./AppThemeProvider");

type ThemeState = ReturnType<typeof useTheme>;

const root = document.documentElement;

/** The theme classes on `<html>`, in order. */
function themeClasses() {
  return [...root.classList].filter((name) => /^(light|dark)$/.test(name));
}

function renderTheme({ bindThemeHotkey = false } = {}) {
  const state: { current?: ThemeState } = {};
  function Probe() {
    state.current = useTheme();
    return null;
  }
  const view = render(
    <AppThemeProvider bindThemeHotkey={bindThemeHotkey}>
      <Probe />
    </AppThemeProvider>
  );
  return {
    ...view,
    get theme() {
      if (!state.current) throw new Error("not rendered");
      return state.current;
    },
  };
}

let store: Map<string, string>;

beforeEach(() => {
  saved = "system";
  userId = "member-1";
  stubColorScheme(false);
  store = new Map();
  stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});

afterEach(() => {
  cleanup();
  root.classList.remove("light", "dark");
  write.mockClear();
  toastRefusedWrite.mockClear();
  unstubAllGlobals();
});

describe("AppThemeProvider's class on <html>", () => {
  it("is light for a light theme, whatever the OS asks for", () => {
    stubColorScheme(true);
    saved = "light";
    const view = renderTheme();
    expect(themeClasses()).toEqual(["light"]);
    expect(view.theme.resolvedTheme).toBe("light");
  });

  it("is dark for a dark theme, whatever the OS asks for", () => {
    saved = "dark";
    const view = renderTheme();
    expect(themeClasses()).toEqual(["dark"]);
    expect(view.theme.resolvedTheme).toBe("dark");
  });

  it("follows the OS for a system theme, as it changes", () => {
    const scheme = stubColorScheme(true);
    const view = renderTheme();
    expect(themeClasses()).toEqual(["dark"]);
    expect(view.theme).toMatchObject({
      theme: "system",
      resolvedTheme: "dark",
    });

    act(() => scheme.setDark(false));
    expect(themeClasses()).toEqual(["light"]);
    expect(view.theme.resolvedTheme).toBe("light");
  });

  it("replaces the head script's class when the saved theme differs", () => {
    root.classList.add("light");
    saved = "dark";
    renderTheme();
    expect(themeClasses()).toEqual(["dark"]);
  });

  it("puts a system theme's class back after React rewrites <html>'s className", () => {
    // The root layout's shape: React owns `<html className>` and renders the
    // provider inside it, so a route refresh that changes the class string
    // re-renders both in one commit.
    stubColorScheme(true);
    const reactRoot = createRoot(document);
    function Document({ className }: { className: string }) {
      return (
        <html className={className}>
          <body>
            <AppThemeProvider bindThemeHotkey={false}>
              <span />
            </AppThemeProvider>
          </body>
        </html>
      );
    }
    try {
      act(() => reactRoot.render(<Document className="font-a" />));
      expect(root.classList.contains("font-a")).toBe(true);
      expect(themeClasses()).toEqual(["dark"]);

      act(() => reactRoot.render(<Document className="font-b" />));
      expect(root.classList.contains("font-a")).toBe(false);
      expect(root.classList.contains("font-b")).toBe(true);
      expect(themeClasses()).toEqual(["dark"]);
    } finally {
      act(() => reactRoot.unmount());
      root.className = "";
    }
  });
});

describe("AppThemeProvider's setTheme", () => {
  it("saves the member's appearance.theme", () => {
    saved = "light";
    const view = renderTheme();
    act(() => view.theme.setTheme("dark"));
    expect(write).toHaveBeenCalledWith({ "appearance.theme": "dark" });
  });

  it("toasts a refused save", async () => {
    const refusal = new Error("Settings are locked");
    write.mockImplementationOnce(() => Promise.reject(refusal));
    const view = renderTheme();
    await act(async () => view.theme.setTheme("dark"));
    expect(toastRefusedWrite).toHaveBeenCalledWith(refusal);
  });

  it("signed out, holds the theme for the page and saves nothing", () => {
    userId = null;
    saved = "light";
    const view = renderTheme();
    act(() => view.theme.setTheme("dark"));
    expect(view.theme.theme).toBe("dark");
    expect(themeClasses()).toEqual(["dark"]);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("AppThemeProvider's stored theme", () => {
  it("keeps the member's theme for the head script", () => {
    saved = "dark";
    renderTheme();
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows the theme as it changes", () => {
    saved = "light";
    const view = renderTheme();
    expect(store.get(THEME_STORAGE_KEY)).toBe("light");

    saved = "dark";
    view.rerender(
      <AppThemeProvider bindThemeHotkey={false}>
        <span />
      </AppThemeProvider>
    );
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("signed out, leaves what the member last chose", () => {
    store.set(THEME_STORAGE_KEY, "dark");
    userId = null;
    saved = "system";
    const view = renderTheme();
    act(() => view.theme.setTheme("light"));
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("carries on when localStorage throws", () => {
    stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("denied");
      },
    });
    saved = "dark";
    expect(() => renderTheme()).not.toThrow();
    expect(themeClasses()).toEqual(["dark"]);
  });
});

describe("AppThemeProvider with a kept theme", () => {
  it("signed out on a system theme, follows the kept theme over the OS", () => {
    store.set(THEME_STORAGE_KEY, "dark");
    userId = null;
    // The head script's class, which hydration must not swap for the OS's.
    root.classList.add("dark");
    const view = renderTheme();
    expect(view.theme.resolvedTheme).toBe("dark");
    expect(themeClasses()).toEqual(["dark"]);
  });

  it("signed out with nothing kept, follows the OS", () => {
    userId = null;
    const view = renderTheme();
    expect(view.theme.resolvedTheme).toBe("light");
    expect(themeClasses()).toEqual(["light"]);
  });

  it("signed out, takes a theme kept in another tab", () => {
    userId = null;
    const view = renderTheme();
    expect(themeClasses()).toEqual(["light"]);

    store.set(THEME_STORAGE_KEY, "dark");
    act(() => {
      fireEvent(window, new Event("storage"));
    });
    expect(view.theme.resolvedTheme).toBe("dark");
    expect(themeClasses()).toEqual(["dark"]);
  });

  it("signed out, lets setTheme override the kept theme for the page", () => {
    store.set(THEME_STORAGE_KEY, "dark");
    userId = null;
    const view = renderTheme();
    act(() => view.theme.setTheme("light"));
    expect(themeClasses()).toEqual(["light"]);
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("signed in on a saved system theme, ignores a stale kept theme", () => {
    store.set(THEME_STORAGE_KEY, "dark");
    const view = renderTheme();
    expect(view.theme.resolvedTheme).toBe("light");
    expect(themeClasses()).toEqual(["light"]);
  });
});

describe("AppThemeProvider's d key", () => {
  it("signed out, toggles the page's theme", () => {
    userId = null;
    saved = "light";
    const view = renderTheme({ bindThemeHotkey: true });
    act(() => {
      fireEvent.keyDown(window, { key: "d" });
    });
    expect(view.theme.theme).toBe("dark");
    expect(themeClasses()).toEqual(["dark"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("is left to the hotkey registry when unbound", () => {
    saved = "light";
    const view = renderTheme({ bindThemeHotkey: false });
    act(() => {
      fireEvent.keyDown(window, { key: "d" });
    });
    expect(view.theme.theme).toBe("light");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("useTheme", () => {
  it("throws outside AppThemeProvider", () => {
    function Orphan() {
      useTheme();
      return null;
    }
    const quiet = mock(() => {});
    const original = console.error;
    console.error = quiet;
    try {
      expect(() => render(<Orphan />)).toThrow("AppThemeProvider");
    } finally {
      console.error = original;
    }
  });
});
