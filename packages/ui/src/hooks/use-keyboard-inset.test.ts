import {
  keyboardInset,
  useKeyboardInset,
} from "@workspace/ui/hooks/use-keyboard-inset";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(() => {
  unstubAllGlobals();
});

describe("keyboardInset", () => {
  it("is 0 when the layout and visual viewports agree (Android after resizes-content)", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
  });

  it("is the shortfall when the visual viewport is shorter (iOS)", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336);
  });

  it("adds the offset the visual viewport has been pushed down by", () => {
    expect(keyboardInset(844, { height: 400, offsetTop: 100 })).toBe(344);
  });
});

describe("useKeyboardInset", () => {
  it("updates when a stubbed visualViewport fires resize", () => {
    const listeners = new Map<string, () => void>();
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerHeight", 844);

    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);

    act(() => {
      visualViewport.height = 508;
      listeners.get("resize")?.();
    });
    expect(result.current).toBe(336);
  });

  it("removes both listeners on unmount", () => {
    const removed: string[] = [];
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: (type: string) => {
        removed.push(type);
      },
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerHeight", 844);

    const { unmount } = renderHook(() => useKeyboardInset());
    unmount();

    expect(removed.sort()).toEqual(["resize", "scroll"]);
  });
});
