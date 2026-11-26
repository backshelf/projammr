import { useEffect, type RefObject } from "react";

import { call } from "./bridge";

/**
 * Tells the app how tall `content` is each time it changes, so the window follows its content; the app keeps it
 * inside the display. `content` is the element sized by what is in it, not the one scrolled by the window.
 */
export function usePanelHeight(content: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      void call("resize_panel", { height: Math.ceil(element.offsetHeight) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);
}
