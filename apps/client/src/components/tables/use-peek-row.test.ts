import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { usePeekRow } from "./use-peek-row";

const ORIGIN = "http://localhost";

function setUrl(url: string) {
  window.history.replaceState(null, "", url);
}

function url() {
  return window.location.pathname + window.location.search;
}

// `peek-param.ts` reads the real location. happy-dom starts on `about:blank`,
// where `history` cannot take a path, so the window is moved onto a real
// origin first; each test then starts from a known entry.
beforeEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(ORIGIN);
  setUrl("/project/1/tracks");
});
afterEach(() => setUrl("/"));

describe("usePeekRow", () => {
  describe("first render", () => {
    it("starts closed on the server even when the URL names a row", () => {
      setUrl("/project/1/tracks?peek=7");
      let seen: number | null | undefined;
      function Probe() {
        [seen] = usePeekRow(true);
        return null;
      }
      renderToString(createElement(Probe));
      expect(seen).toBeNull();
    });

    it("renders closed through the hydration pass, then adopts the URL", async () => {
      setUrl("/project/1/tracks?peek=7");
      const seen: (number | null)[] = [];
      function Probe() {
        const [peekId] = usePeekRow(true);
        seen.push(peekId);
        return null;
      }
      const container = document.createElement("div");
      container.innerHTML = renderToString(createElement(Probe));
      seen.length = 0;

      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, createElement(Probe));
      });

      expect(seen[0]).toBeNull();
      expect(seen.at(-1)).toBe(7);
      await act(async () => root.unmount());
    });
  });

  describe("adopting the URL", () => {
    it("adopts the URL's row once hydrated when persisting", () => {
      setUrl("/project/1/tracks?peek=7");
      const { result } = renderHook(() => usePeekRow(true));
      expect(result.current[0]).toBe(7);
    });

    it("stays closed when the URL names no valid row", () => {
      setUrl("/project/1/tracks?peek=abc");
      const { result } = renderHook(() => usePeekRow(true));
      expect(result.current[0]).toBeNull();
    });

    it("never adopts the URL when not persisting", () => {
      setUrl("/project/1/tracks?peek=7");
      const { result } = renderHook(() => usePeekRow(false));
      expect(result.current[0]).toBeNull();
    });
  });

  describe("setPeek", () => {
    it("pushes a history entry on open when persisting", () => {
      const { result } = renderHook(() => usePeekRow(true));
      const before = window.history.length;
      act(() => result.current[1](4));
      expect(result.current[0]).toBe(4);
      expect(url()).toBe("/project/1/tracks?peek=4");
      expect(window.history.length).toBe(before + 1);
    });

    it("replaces the entry on close when persisting", () => {
      setUrl("/project/1/tracks?peek=4");
      const { result } = renderHook(() => usePeekRow(true));
      const before = window.history.length;
      act(() => result.current[1](null));
      expect(result.current[0]).toBeNull();
      expect(url()).toBe("/project/1/tracks");
      expect(window.history.length).toBe(before);
    });

    it("keeps the other query params when writing the row", () => {
      setUrl("/project/1/tracks?sort=title");
      const { result } = renderHook(() => usePeekRow(true));
      act(() => result.current[1](4));
      expect(url()).toBe("/project/1/tracks?sort=title&peek=4");
    });

    it("writes nothing when the URL already holds the row", () => {
      setUrl("/project/1/tracks?peek=4");
      const { result } = renderHook(() => usePeekRow(true));
      const before = window.history.length;
      act(() => result.current[1](4));
      expect(window.history.length).toBe(before);
      expect(url()).toBe("/project/1/tracks?peek=4");
    });

    it("updates state but leaves the URL alone when not persisting", () => {
      const { result } = renderHook(() => usePeekRow(false));
      const before = window.history.length;
      act(() => result.current[1](4));
      expect(result.current[0]).toBe(4);
      expect(url()).toBe("/project/1/tracks");
      expect(window.history.length).toBe(before);
      act(() => result.current[1](null));
      expect(result.current[0]).toBeNull();
    });
  });

  describe("popstate", () => {
    it("re-adopts the URL's row when persisting", () => {
      const { result } = renderHook(() => usePeekRow(true));
      expect(result.current[0]).toBeNull();

      setUrl("/project/1/tracks?peek=9");
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(result.current[0]).toBe(9);

      setUrl("/project/1/tracks");
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(result.current[0]).toBeNull();
    });

    it("is ignored when not persisting", () => {
      const { result } = renderHook(() => usePeekRow(false));
      setUrl("/project/1/tracks?peek=9");
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(result.current[0]).toBeNull();
    });
  });
});
