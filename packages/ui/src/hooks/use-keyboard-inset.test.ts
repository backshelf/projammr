import {
  isEditableElement,
  keyboardInset,
  useKeyboardInset,
} from "@workspace/ui/hooks/use-keyboard-inset";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
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

describe("isEditableElement", () => {
  it("matches text inputs, textareas, selects, and contenteditable elements", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const button = document.createElement("button");

    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(textarea)).toBe(true);
    expect(isEditableElement(select)).toBe(true);
    expect(isEditableElement(editable)).toBe(true);
    expect(isEditableElement(checkbox)).toBe(false);
    expect(isEditableElement(button)).toBe(false);
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

  it("detects Android resizes-content keyboard open, blur, and resize restore", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);

    // Focus input, then shrink both innerHeight and visualViewport (Android resizes-content)
    act(() => {
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      stubGlobal("innerHeight", 520);
      visualViewport.height = 520;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(324);

    // Resets cleanly on blur even before viewport restores
    act(() => {
      input.blur();
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null })
      );
    });
    expect(result.current).toBe(0);

    // Focus again, keyboard opens, then keyboard dismisses via resize restore while focused
    act(() => {
      stubGlobal("innerHeight", 844);
      visualViewport.height = 844;
      window.dispatchEvent(new Event("resize"));
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      stubGlobal("innerHeight", 520);
      visualViewport.height = 520;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(324);

    act(() => {
      stubGlobal("innerHeight", 844);
      visualViewport.height = 844;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(0);
  });

  it("ignores height drops when no editable element is focused or drop is small", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const { result } = renderHook(() => useKeyboardInset());

    // Shrink without editable focus (e.g. window resize / split-screen)
    act(() => {
      stubGlobal("innerHeight", 520);
      visualViewport.height = 520;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(0);

    // Small drop while focused (e.g. browser toolbar)
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      stubGlobal("innerHeight", 844);
      window.dispatchEvent(new Event("resize"));
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      stubGlobal("innerHeight", 780);
      visualViewport.height = 780;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(0);
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

  it("preserves keyboard inset across rotation/width change while keyboard is open", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useKeyboardInset());

    act(() => {
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      stubGlobal("innerHeight", 500);
      visualViewport.height = 500;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(344);

    // Rotate to landscape while keyboard stays open
    act(() => {
      stubGlobal("innerWidth", 640);
      stubGlobal("innerHeight", 180);
      visualViewport.height = 180;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBeGreaterThan(0);

    // Keyboard dismisses in landscape
    act(() => {
      stubGlobal("innerHeight", 390);
      visualViewport.height = 390;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(0);
  });

  it("detects Android resizes-content when resize fires shortly before focusin", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useKeyboardInset());

    act(() => {
      stubGlobal("innerHeight", 500);
      visualViewport.height = 500;
      window.dispatchEvent(new Event("resize"));
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(result.current).toBe(344);
  });

  it("preserves the pre-shrink baseline across a two-step resize before focusin", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useKeyboardInset());

    act(() => {
      stubGlobal("innerHeight", 700);
      visualViewport.height = 700;
      window.dispatchEvent(new Event("resize"));

      stubGlobal("innerHeight", 650);
      visualViewport.height = 650;
      window.dispatchEvent(new Event("resize"));

      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(result.current).toBe(194);
  });

  it("does not reset baseline when a second subscriber mounts while keyboard is open", () => {
    const visualViewport = {
      height: 844,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    stubGlobal("visualViewport", visualViewport);
    stubGlobal("innerWidth", 390);
    stubGlobal("innerHeight", 844);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const first = renderHook(() => useKeyboardInset());

    act(() => {
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      stubGlobal("innerHeight", 500);
      visualViewport.height = 500;
      window.dispatchEvent(new Event("resize"));
    });
    expect(first.result.current).toBe(344);

    const second = renderHook(() => useKeyboardInset());
    expect(first.result.current).toBe(344);
    expect(second.result.current).toBe(344);

    second.unmount();
    expect(first.result.current).toBe(344);
  });
});
