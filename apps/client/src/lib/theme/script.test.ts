import { afterEach, describe, expect, it } from "bun:test";
import { THEME_ATTRIBUTE } from "@workspace/settings/appearance";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { DEFAULT_EFFECTIVE_SETTINGS } from "@/lib/settings/effective";
import {
  explicitTheme,
  SIGNED_OUT_ATTRIBUTE,
  storedTheme,
  storeTheme,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from "./script";
import { stubColorScheme } from "./test-support";

const root = document.documentElement;

/** A stand-in `localStorage`; `null` is one whose every call throws. */
function stubStorage(entries: Record<string, string> | null) {
  const store = new Map(Object.entries(entries ?? {}));
  stubGlobal(
    "localStorage",
    entries === null
      ? {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("denied");
          },
        }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
        }
  );
  return store;
}

function runOn(
  theme: string,
  osDark: boolean,
  stored: Record<string, string> | null = {},
  signedOut = true
) {
  root.classList.remove("light", "dark");
  stubColorScheme(osDark);
  stubStorage(stored);
  root.setAttribute(THEME_ATTRIBUTE, theme);
  if (signedOut) root.setAttribute(SIGNED_OUT_ATTRIBUTE, "");
  else root.removeAttribute(SIGNED_OUT_ATTRIBUTE);
  new Function(THEME_SCRIPT)();
  return [...root.classList].filter((name) => /^(light|dark)$/.test(name));
}

afterEach(() => {
  root.removeAttribute(THEME_ATTRIBUTE);
  root.removeAttribute(SIGNED_OUT_ATTRIBUTE);
  root.classList.remove("light", "dark");
  unstubAllGlobals();
});

describe("THEME_SCRIPT", () => {
  it("adds dark to a system theme when the OS is dark", () => {
    expect(runOn("system", true)).toEqual(["dark"]);
  });

  it("adds light to a system theme when the OS is light", () => {
    expect(runOn("system", false)).toEqual(["light"]);
  });

  it("leaves an explicit theme to the server's class", () => {
    expect(runOn("dark", false)).toEqual([]);
    expect(runOn("light", true)).toEqual([]);
  });

  it("uses the stored dark theme for a system one on a light OS", () => {
    expect(runOn("system", false, { [THEME_STORAGE_KEY]: "dark" })).toEqual([
      "dark",
    ]);
  });

  it("uses the stored light theme for a system one on a dark OS", () => {
    expect(runOn("system", true, { [THEME_STORAGE_KEY]: "light" })).toEqual([
      "light",
    ]);
  });

  it("follows the OS when the stored theme is system or unrecognised", () => {
    expect(runOn("system", true, { [THEME_STORAGE_KEY]: "system" })).toEqual([
      "dark",
    ]);
    expect(runOn("system", false, { [THEME_STORAGE_KEY]: "sepia" })).toEqual([
      "light",
    ]);
  });

  it("follows the OS when localStorage throws", () => {
    expect(runOn("system", true, null)).toEqual(["dark"]);
  });

  it("follows the OS for a signed-in system theme whatever is stored", () => {
    expect(
      runOn("system", false, { [THEME_STORAGE_KEY]: "dark" }, false)
    ).toEqual(["light"]);
  });

  it("leaves an explicit theme alone whatever is stored", () => {
    expect(runOn("light", true, { [THEME_STORAGE_KEY]: "dark" })).toEqual([]);
  });
});

describe("the offline page's <html>", () => {
  // The service worker precaches `/offline` signed out, so the root layout
  // renders it from the instance's settings; a default instance is `system`.
  it("carries no explicit theme class under the default instance settings", () => {
    expect(
      explicitTheme(DEFAULT_EFFECTIVE_SETTINGS.values["appearance.theme"])
    ).toBeUndefined();
  });
});

describe("storeTheme", () => {
  it("keeps the theme under the key the script reads", () => {
    const store = stubStorage({});
    storeTheme("dark");
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("carries on when localStorage throws", () => {
    stubStorage(null);
    expect(() => storeTheme("dark")).not.toThrow();
  });
});

describe("storedTheme", () => {
  it("reads a kept light or dark theme", () => {
    stubStorage({ [THEME_STORAGE_KEY]: "dark" });
    expect(storedTheme()).toBe("dark");
    stubStorage({ [THEME_STORAGE_KEY]: "light" });
    expect(storedTheme()).toBe("light");
  });

  it("is null for nothing kept, system or an unrecognised value", () => {
    stubStorage({});
    expect(storedTheme()).toBeNull();
    stubStorage({ [THEME_STORAGE_KEY]: "system" });
    expect(storedTheme()).toBeNull();
    stubStorage({ [THEME_STORAGE_KEY]: "sepia" });
    expect(storedTheme()).toBeNull();
  });

  it("is null when localStorage throws", () => {
    stubStorage(null);
    expect(storedTheme()).toBeNull();
  });
});
