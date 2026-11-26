import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, renderHook } from "@testing-library/react";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import type { ReactNode } from "react";

const triggerHaptic = mock();
mock.module("use-haptic", () => ({
  useHaptic: () => ({ triggerHaptic }),
}));

const { HapticsProvider, useHaptics } = await import("./haptics");

/** A finger landing on `target`, the way a touch screen reports it. */
function touch(target: Element) {
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  target.dispatchEvent(event);
}

beforeEach(() => {
  // A touch device: the primary pointer is coarse.
  stubGlobal("matchMedia", () => ({ matches: true }));
});

afterEach(() => {
  cleanup();
  unstubAllGlobals();
  triggerHaptic.mockClear();
});

const provider =
  (enabled: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <HapticsProvider enabled={enabled}>{children}</HapticsProvider>
  );

describe("HapticsProvider", () => {
  it("buzzes a press and a useHaptics call while enabled", () => {
    const { getByRole } = render(<button type="button">Play</button>, {
      wrapper: provider(true),
    });
    touch(getByRole("button"));
    expect(triggerHaptic).toHaveBeenCalledTimes(1);

    const { result } = renderHook(useHaptics, { wrapper: provider(true) });
    result.current();
    expect(triggerHaptic).toHaveBeenCalledTimes(2);
  });

  it("buzzes nothing, pressed or called, once the viewer turns it off", () => {
    const { getByRole } = render(<button type="button">Play</button>, {
      wrapper: provider(false),
    });
    touch(getByRole("button"));

    const { result } = renderHook(useHaptics, { wrapper: provider(false) });
    result.current();

    expect(triggerHaptic).not.toHaveBeenCalled();
  });
});
