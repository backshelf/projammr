"use client";

import { ComboCaps } from "@/components/hotkeys/combo-caps";
import { canonicalCombo, CHORD_WINDOW_MS } from "@workspace/ui/lib/keymap";
import { useEffect, useEffectEvent, useState } from "react";
import type { KeyboardEvent } from "react";

const BARE_LETTER = /^[a-z]$/;

/**
 * Captures one key combo from the keyboard and hands it up in canonical form.
 * It listens on its own focused element and consumes every key it sees, so the
 * window keymap runs nothing while it captures; only Tab passes through, so
 * focus can always leave. A bare `Escape` cancels and can never be captured.
 * A bare letter waits `chordWindowMs` for a second press: a press inside the
 * window makes the chord, the window running out captures the letter alone.
 * Any other first press captures at once. Losing focus drops a pending letter
 * and cancels. It never checks the combo against anything; the caller does.
 */
export function KeyCapture({
  apple,
  label,
  onCapture,
  onCancel,
  chordWindowMs = CHORD_WINDOW_MS,
  autoFocus,
}: {
  apple: boolean;
  /** What the keys are for, named in the control's accessible name. */
  label: string;
  onCapture: (combo: string) => void;
  onCancel: () => void;
  chordWindowMs?: number;
  autoFocus?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const capture = useEffectEvent(onCapture);

  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => {
      setPending(null);
      capture(pending);
    }, chordWindowMs);
    return () => clearTimeout(timer);
  }, [pending, chordWindowMs]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;

    const combo = canonicalCombo(event);
    if (combo === null) return;
    if (combo === "Escape") {
      setPending(null);
      onCancel();
      return;
    }
    if (pending !== null) {
      setPending(null);
      onCapture(`${pending} ${combo}`);
    } else if (BARE_LETTER.test(combo)) {
      setPending(combo);
    } else {
      onCapture(combo);
    }
  }

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        aria-label={`Press the new keys for ${label}`}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setPending(null);
          onCancel();
        }}
        className="flex min-h-8 min-w-32 items-center rounded-sm border border-rule px-2 text-small text-ink-soft focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden coarse:min-h-11"
      >
        {pending === null ? (
          "Press keys…"
        ) : (
          <ComboCaps combo={pending} apple={apple} />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {pending === null ? "" : `${pending}, waiting for a second key`}
      </span>
    </span>
  );
}
