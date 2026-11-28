import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { StructureDiff } from "@workspace/session-diff";
import { SetSkyline } from "@workspace/ui/components/session-structure/set-skyline";
import { useReducedMotion } from "@workspace/ui/lib/motion";

import { describeRow, litRows, summarize } from "./skyline-model";

/** The index a bar carries, from anything inside it. */
function barIndexOf(target: EventTarget | null): number | null {
  const bar = (target as Element | null)?.closest?.("[data-diff-bar]");
  const index = bar?.getAttribute("data-diff-bar");
  return index == null ? null : Number(index);
}

/** Where `key` takes the lit bar from `from` among `count` bars; null for a key that moves nothing. */
function steppedTo(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return Math.min(from + 1, count - 1);
    case "ArrowLeft":
      return Math.max(from - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The set's skyline as the panel's instrument: `SetSkyline` in the Changes mode, so the tracks the last commit
 * does not account for stand lit and the rest recede. It is one tab stop. `←`/`→`/`Home`/`End` move across the
 * tracks, pointing does the same, and a live line under it names the track ("Bass · +EQ Eight") for a person who
 * cannot see which bar is lit; with none pointed at it says how many are. A lit bar stays lit under reduced motion:
 * only the fade between the two states goes.
 */
export function SkylineReadout({
  structure,
  committed,
}: {
  structure: StructureDiff;
  /** Whether the set has a commit to differ from; with none every track is new and the line says so. */
  committed: boolean;
}): JSX.Element {
  const lineId = useId();
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
  const count = structure.rows.length;
  // With no track lit, dimming the rest would ghost the whole instrument: it shows every track whole instead.
  const lit = litRows(structure).length > 0;
  const active = pointed ?? focused;
  const row = active === null ? undefined : structure.rows[active];

  // The lit bar is a DOM attribute the skyline's classes read (`data-hot`), as the web's save diff writes it: the
  // skyline is markup with no state of its own.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.removeAttribute("data-hot");
    for (const element of root.querySelectorAll("[data-hot]")) {
      element.removeAttribute("data-hot");
    }
    if (active === null) return;
    root.setAttribute("data-hot", "");
    root
      .querySelector(`[data-diff-bar="${active}"]`)
      ?.setAttribute("data-hot", "");
  }, [active, count]);

  function onFocus(event: FocusEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget || focused !== null) return;
    // The first stop is the first lit track: the one the person came to see.
    const first = structure.rows.findIndex((entry) => entry.status !== "same");
    setFocused(first < 0 ? 0 : first);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey || count === 0) return;
    const next = steppedTo(event.key, focused ?? 0, count);
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
  }

  function onPointerOver(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "touch") return;
    setPointed(barIndexOf(event.target) ?? pointed);
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    const index = barIndexOf(event.target);
    if (index !== null) {
      setFocused(index);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={rootRef}
        role="group"
        aria-label="The set's tracks"
        aria-describedby={lineId}
        tabIndex={0}
        data-mode={lit ? "changes" : "whole"}
        onFocus={onFocus}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(null);
          }
        }}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerOver={onPointerOver}
        onPointerLeave={() => setPointed(null)}
        data-reduced-motion={reducedMotion ? "" : undefined}
        className="skyline-readout group/save-diff rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <SetSkyline structure={structure} />
      </div>
      <p
        id={lineId}
        aria-live="polite"
        aria-atomic="true"
        className="min-h-[1lh] text-small text-ink-soft"
      >
        {row ? (
          <span className="text-ink">{describeRow(row)}</span>
        ) : (
          summarize(structure, committed)
        )}
      </p>
    </div>
  );
}
