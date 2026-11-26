import {
  APPEARANCE,
  readAppearance,
  useAppearance,
  useDensity,
} from "@workspace/ui/lib/appearance";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

const root = document.documentElement;

afterEach(() => {
  cleanup();
  for (const { attribute } of Object.values(APPEARANCE))
    root.removeAttribute(attribute);
  document.head.querySelector("style[data-test-density]")?.remove();
});

describe("APPEARANCE", () => {
  it("lists each preference's default among its values", () => {
    for (const [key, entry] of Object.entries(APPEARANCE))
      expect(entry.values as readonly string[], key).toContain(entry.default);
  });

  it("gives every preference its own attribute", () => {
    const attributes = Object.values(APPEARANCE).map((e) => e.attribute);
    expect(new Set(attributes).size).toBe(attributes.length);
  });
});

describe("readAppearance", () => {
  it("reads the value <html> carries", () => {
    root.setAttribute("data-density", "compact");
    expect(readAppearance("density")).toBe("compact");
  });

  it("falls back to the default with no attribute", () => {
    expect(readAppearance("text")).toBe("md");
  });

  it("falls back to the default for a value outside the preference's", () => {
    root.setAttribute("data-grain", "loud");
    expect(readAppearance("grain")).toBe("full");
  });
});

describe("useAppearance", () => {
  it("follows the attribute as it changes", async () => {
    const { result } = renderHook(() => useAppearance("width"));
    expect(result.current).toBe("narrow");

    act(() => root.setAttribute("data-width", "wide"));
    await waitFor(() => expect(result.current).toBe("wide"));

    act(() => root.removeAttribute("data-width"));
    await waitFor(() => expect(result.current).toBe("narrow"));
  });
});

describe("useDensity", () => {
  it("is 1 at the default", () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current).toBe(1);
  });

  it("reads the factor the stylesheet sets for the density", async () => {
    const style = document.createElement("style");
    style.dataset.testDensity = "";
    style.textContent = ':root[data-density="compact"] { --density: 0.5; }';
    document.head.append(style);

    const { result } = renderHook(() => useDensity());
    act(() => root.setAttribute("data-density", "compact"));
    await waitFor(() => expect(result.current).toBe(0.5));
  });
});
