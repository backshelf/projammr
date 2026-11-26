import type { Composer } from "./suggestion";

/**
 * The commit box's draft for each set, kept in the webview's `localStorage` so a screen change, a reload of the
 * panel or a restart of the app finds what was half-written. The key carries its version: a shape this code does
 * not know is left alone and read as no draft.
 */
export const DRAFTS_KEY = "dit-app:commit-drafts:v1";

type Drafts = Record<string, Composer>;

function isComposer(value: unknown): value is Composer {
  if (typeof value !== "object" || value === null) return false;
  const { text, edited, dropped } = value as Record<string, unknown>;
  return (
    typeof text === "string" &&
    typeof edited === "boolean" &&
    Array.isArray(dropped) &&
    dropped.every((entry) => typeof entry === "string")
  );
}

function read(): Drafts {
  const stored = localStorage.getItem(DRAFTS_KEY);
  if (stored === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([, entry]) => isComposer(entry))
  );
}

/** The draft kept for the set at `set`, or null when there is none. */
export function loadDraft(set: string): Composer | null {
  return read()[set] ?? null;
}

/** Keeps `composer` as the set's draft: a box with nothing written and nothing switched off is no draft at all. */
export function saveDraft(set: string, composer: Composer): void {
  const drafts = read();
  if (composer.edited || composer.dropped.length > 0) {
    drafts[set] = composer;
  } else {
    delete drafts[set];
  }
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

/** Lets go of the set's draft: it was committed. */
export function clearDraft(set: string): void {
  const drafts = read();
  delete drafts[set];
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}
