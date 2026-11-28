import { useEffect, type RefObject } from "react";

import { call } from "./bridge";

/**
 * Tells the app how tall `content` is each time it changes, coalesced to one `resize_panel` call per animation
 * frame and deduplicated by rounded pixel height so ResizeObserver bursts never churn IPC.
 */
export function usePanelHeight(content: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    let lastHeight = -1;

    const report = (): void => {
      frame = null;
      const next = Math.ceil(element.offsetHeight);
      if (next === lastHeight) return;
      lastHeight = next;
      void call("resize_panel", { height: next });
    };

    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(report);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [content]);
}
