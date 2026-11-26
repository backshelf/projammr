import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useDeepLink } from "./use-deep-link";

const GRACE = 1200;

describe("useDeepLink", () => {
  let hasFocus = true;
  let originalHasFocus: typeof document.hasFocus;

  beforeEach(() => {
    jest.useFakeTimers();
    hasFocus = true;
    originalHasFocus = document.hasFocus;
    document.hasFocus = () => hasFocus;
  });

  afterEach(() => {
    document.hasFocus = originalHasFocus;
    jest.useRealTimers();
    window.location.hash = "";
  });

  it("navigates to the href it is given", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#go"));
    expect(window.location.href).toContain("projammr://session/1#go");
  });

  it("opens the fallback when nothing answers inside the window", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#a"));
    expect(result.current.fallbackOpen).toBe(false);
    act(() => jest.advanceTimersByTime(GRACE));
    expect(result.current.fallbackOpen).toBe(true);
  });

  it("stays closed when the window blurs inside the window", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#b"));
    act(() => {
      window.dispatchEvent(new Event("blur"));
      jest.advanceTimersByTime(GRACE);
    });
    expect(result.current.fallbackOpen).toBe(false);
  });

  it("stays closed when the tab is hidden inside the window", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#c"));
    const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        jest.advanceTimersByTime(GRACE);
      });
    } finally {
      if (hidden) Object.defineProperty(document, "hidden", hidden);
      else delete (document as { hidden?: boolean }).hidden;
    }
    expect(result.current.fallbackOpen).toBe(false);
  });

  it("clears the timer on unmount so nothing fires afterwards", () => {
    const { result, unmount } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#d"));
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("restarts the window when open is called again", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#e"));
    act(() => jest.advanceTimersByTime(GRACE - 200));
    act(() => result.current.open("projammr://session/1#f"));
    act(() => jest.advanceTimersByTime(GRACE - 200));
    expect(result.current.fallbackOpen).toBe(false);
    act(() => jest.advanceTimersByTime(200));
    expect(result.current.fallbackOpen).toBe(true);
  });

  it("closes the fallback through setFallbackOpen", () => {
    const { result } = renderHook(() => useDeepLink());
    act(() => result.current.open("projammr://session/1#g"));
    act(() => jest.advanceTimersByTime(GRACE));
    expect(result.current.fallbackOpen).toBe(true);
    act(() => result.current.setFallbackOpen(false));
    expect(result.current.fallbackOpen).toBe(false);
  });
});
