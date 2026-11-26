"use client";

import { useLayoutEffect, type RefObject } from "react";

const STORAGE_KEY = "pj:scroll";
const STAMP = "__pjEntry";
/** How long a restore keeps waiting for streamed content to reach the offset. */
const RETRY_MS = 1000;

type Offsets = Record<string, number>;

/**
 * The Navigation API's id for the entry the page is standing on, where the
 * platform has the API at all — iOS before 18.4 does not, and the DOM types
 * declare it as always present.
 */
function navigationKey(): string | undefined {
  const navigation = window.navigation as Navigation | undefined;
  return navigation?.currentEntry?.key;
}

function readOffsets(): Offsets {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Offsets;
  } catch {
    return {};
  }
}

function writeOffset(key: string, top: number) {
  const offsets = readOffsets();
  offsets[key] = top;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(offsets));
}

/**
 * The identity of the history entry the page is standing on. The Navigation
 * API owns one per entry and Next never rewrites it. Where it is missing (iOS
 * before 18.4), the entry is stamped once and the stamp is put back whenever
 * Next's own history writes drop it, with the same value, never a new one:
 * a stamp that changed would orphan the offset saved under the old one.
 */
function entryKey(): string {
  const platform = navigationKey();
  if (platform) return platform;
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const stamped = state[STAMP];
  if (typeof stamped === "string") return stamped;
  const key = crypto.randomUUID();
  window.history.replaceState({ ...state, [STAMP]: key }, "");
  return key;
}

/**
 * Re-applies `key` if a Next history write has dropped it. Only the fallback
 * path needs this; the Navigation API key survives every write.
 */
function keepStamp(key: string) {
  if (navigationKey()) return;
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  if (state[STAMP] === key) return;
  window.history.replaceState({ ...state, [STAMP]: key }, "");
}

/**
 * Saves the container's offset under the current history entry as it scrolls
 * and puts it back when the entry is returned to — a back or forward
 * traverse, or a reload. The write happens in a layout effect, before paint,
 * so the page never shows its top first.
 *
 * `pane` names the container for a page that owns more than one at a time,
 * so the panes keep their own offsets rather than the last one scrolled
 * writing over the rest; a page with a single container needs none.
 *
 * Streamed sections can leave the page shorter than the saved offset on the
 * first write, which the browser clamps. A ResizeObserver on the container's
 * content re-applies the target as the page grows, until it is reached, the
 * deadline passes, or the reader touches the page — a late section must
 * never move a page someone has started reading.
 */
export function useScrollRestoration(
  ref: RefObject<HTMLElement | null>,
  pane?: string
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const entry = entryKey();
    const key = pane ? `${entry}#${pane}` : entry;
    const target = readOffsets()[key] ?? 0;

    let settled = target === 0;
    const apply = () => {
      el.scrollTop = target;
      if (el.scrollTop >= target - 1) settled = true;
    };
    apply();

    const content = settled ? null : el.firstElementChild;
    const observer = content
      ? new ResizeObserver(() => {
          if (!settled) apply();
          if (settled) observer?.disconnect();
        })
      : null;
    if (content) observer?.observe(content);

    const deadline = window.setTimeout(() => {
      settled = true;
      observer?.disconnect();
    }, RETRY_MS);

    const cancel = () => {
      settled = true;
      observer?.disconnect();
    };
    const gestures = ["touchstart", "wheel", "keydown", "pointerdown"] as const;
    for (const type of gestures) {
      window.addEventListener(type, cancel, { passive: true, once: true });
    }

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        keepStamp(entry);
        writeOffset(key, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const onPageHide = () => writeOffset(key, el.scrollTop);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      for (const type of gestures) window.removeEventListener(type, cancel);
      window.clearTimeout(deadline);
      observer?.disconnect();
    };
  }, [ref, pane]);
}
