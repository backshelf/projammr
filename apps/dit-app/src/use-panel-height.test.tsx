import { afterEach, describe, expect, test } from "bun:test";
import { useRef, type JSX } from "react";
import { render, waitFor } from "@testing-library/react";

import { usePanelHeight } from "./use-panel-height";
import { argsOf, base, mockApp, teardown } from "./test-support";

let restoreObservers: (() => void) | null = null;

afterEach(() => {
  restoreObservers?.();
  restoreObservers = null;
  return teardown();
});

function Box({ height }: { height: { current: number } }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  usePanelHeight(ref);
  return (
    <div
      ref={(node) => {
        if (node) {
          Object.defineProperty(node, "offsetHeight", {
            configurable: true,
            get: () => height.current,
          });
        }
        ref.current = node;
      }}
    />
  );
}

describe("usePanelHeight", () => {
  test("coalesces multiple ResizeObserver bursts per animation frame and deduplicates identical heights", async () => {
    const calls = mockApp(base);
    let observerCallback: ResizeObserverCallback | null = null;
    const originalRO = globalThis.ResizeObserver;
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCAF = globalThis.cancelAnimationFrame;

    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextId = 1;

    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        observerCallback = cb;
      }
      observe(): void {
        return undefined;
      }
      unobserve(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    };
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      const id = nextId++;
      queuedFrames.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id: number): void => {
      queuedFrames.delete(id);
    };
    restoreObservers = (): void => {
      globalThis.ResizeObserver = originalRO;
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCAF;
    };

    const height = { current: 240.2 };
    render(<Box height={height} />);

    // Burst of three observer notifications within one frame -> only one rAF scheduled.
    observerCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    observerCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    observerCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(queuedFrames.size).toBe(1);

    // Flushing that frame sends resize_panel once (Math.ceil(240.2) === 241).
    for (const [id, cb] of queuedFrames) {
      queuedFrames.delete(id);
      cb(16);
    }
    await waitFor(() =>
      expect(argsOf(calls, "resize_panel")).toEqual([{ height: 241 }])
    );

    // Another resize with identical rounded height (240.9 -> 241) is deduplicated.
    height.current = 240.9;
    observerCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    for (const [id, cb] of queuedFrames) {
      queuedFrames.delete(id);
      cb(32);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(argsOf(calls, "resize_panel")).toEqual([{ height: 241 }]);

    // A genuinely different height sends resize_panel again.
    height.current = 320;
    observerCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    for (const [id, cb] of queuedFrames) {
      queuedFrames.delete(id);
      cb(48);
    }
    await waitFor(() =>
      expect(argsOf(calls, "resize_panel")).toEqual([
        { height: 241 },
        { height: 320 },
      ])
    );
  });
});
