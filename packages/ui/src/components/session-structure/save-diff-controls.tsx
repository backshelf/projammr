"use client";

import { IconButton } from "@workspace/ui/components/icon-button";
import { SegmentedPill } from "@workspace/ui/components/segmented-pill";
import { pluralizeCount } from "@workspace/session-diff/format";
import { isTypingTarget } from "@workspace/ui/lib/keymap";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import {
  createContext,
  use,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

/** What the card's outline shows: every track, or only the ones a save changed. */
export type SaveDiffMode = "whole" | "changes";

type SaveDiffControlsValue = {
  state: { mode: SaveDiffMode; step: number; changes: number };
  actions: {
    setMode: (mode: SaveDiffMode) => void;
    stepBy: (delta: 1 | -1) => void;
  };
};

const SaveDiffControlsContext = createContext<SaveDiffControlsValue | null>(
  null
);

function useSaveDiffControls(): SaveDiffControlsValue {
  const value = use(SaveDiffControlsContext);
  if (!value) {
    throw new Error("A save diff control must sit inside SaveDiffControls.");
  }
  return value;
}

/** The index a skyline bar or an outline row carries, which the other shares. */
function diffIndexOf(target: EventTarget | null): number | null {
  const element = (target as Element | null)?.closest?.(
    "[data-diff-row],[data-diff-bar]"
  );
  const index =
    element?.getAttribute("data-diff-row") ??
    element?.getAttribute("data-diff-bar");
  return index == null ? null : Number(index);
}

/**
 * The client half of a save diff card, wrapped around the card the server
 * rendered. It receives no data, only the number of changed tracks to label
 * its stepper with: every row and bar carries its index in the set, which is
 * all it needs. Pointing at a row lights its bar and dims the rest, and
 * pointing at a bar lights its row; a bar clicked or a change stepped to is
 * scrolled to, with any shut group around it opened, and a bar whose track
 * the Changes view hides switches the card to the whole set first. `[` and
 * `]` step while focus is anywhere in the card. The mode sits on the wrapper
 * as `data-mode`, where the card's own classes read it, so switching it never
 * re-renders the card; a save that changed no track always shows the whole
 * set, since the Changes view would have nothing in it.
 *
 * Key it by the two saves it compares. A step and a lit bar belong to one
 * comparison, and a page that changes the comparison through its search
 * params, or refreshes with a newer save, keeps it mounted otherwise.
 */
export function SaveDiffControls({
  changes,
  defaultMode,
  className,
  children,
}: {
  /** How many tracks the save changed, which the stepper walks. */
  changes: number;
  defaultMode: SaveDiffMode;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<SaveDiffMode>(defaultMode);
  const mode: SaveDiffMode = changes === 0 ? "whole" : chosen;
  const [step, setStep] = useState(0);
  // The row a step landed on stays lit when the pointer moves away again.
  const steppedRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  /** Lights one index's row and bar, or nothing. Written to the DOM, so the
   *  pointer never re-renders the card. */
  const light = (index: number | null) => {
    const root = rootRef.current;
    if (!root) return;
    for (const element of root.querySelectorAll("[data-hot]")) {
      if (element !== root) element.removeAttribute("data-hot");
    }
    if (index == null) {
      root.removeAttribute("data-hot");
      return;
    }
    root.setAttribute("data-hot", "");
    for (const element of root.querySelectorAll(
      `[data-diff-row="${index}"],[data-diff-bar="${index}"]`
    )) {
      element.setAttribute("data-hot", "");
    }
  };

  /** Brings an index's row into view, opening the groups around it, and lights it. */
  const reveal = (index: number, behavior: ScrollBehavior) => {
    const row = rootRef.current?.querySelector<HTMLElement>(
      `[data-diff-row="${index}"]`
    );
    if (!row) return;
    // A row the Changes view hides has no box to scroll to until the whole
    // set shows, so the switch lands before the scroll does.
    if (mode === "changes" && row.closest("[data-unchanged]")) {
      // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- one click, and the row must be on screen before it can be scrolled to
      flushSync(() => setChosen("whole"));
    }
    for (
      let details = row.parentElement?.closest("details");
      details;
      details = details.parentElement?.closest("details")
    ) {
      details.open = true;
    }
    row.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : behavior,
    });
    steppedRef.current = index;
    light(index);
  };

  const stepBy = (delta: 1 | -1) => {
    const rows = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-diff-row][data-change]"
      ) ?? []),
    ];
    if (rows.length === 0) return;
    const current = step === 0 ? (delta > 0 ? 0 : rows.length + 1) : step;
    const next = ((current - 1 + delta + rows.length) % rows.length) + 1;
    setStep(next);
    // A key is pressed over and over; its step lands at once.
    reveal(Number(rows[next - 1]!.getAttribute("data-diff-row")), "auto");
  };

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    light(diffIndexOf(event.target) ?? steppedRef.current);
  };

  const onPointerLeave = () => light(steppedRef.current);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const bar = (event.target as Element).closest?.("[data-diff-bar]");
    if (bar) reveal(Number(bar.getAttribute("data-diff-bar")), "smooth");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "]" || event.key === "[") {
      event.preventDefault();
      stepBy(event.key === "]" ? 1 : -1);
    }
  };

  return (
    <SaveDiffControlsContext
      value={{
        state: { mode, step, changes },
        actions: { setMode: setChosen, stepBy },
      }}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        data-mode={mode}
        data-linked=""
        className={cn("group/save-diff outline-none", className)}
        onPointerOver={onPointerOver}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </SaveDiffControlsContext>
  );
}

/** Whether the card's outline shows every track or only the changed ones. */
export function SaveDiffModeSwitch() {
  const { state, actions } = useSaveDiffControls();
  if (state.changes === 0) return null;

  return (
    <SegmentedPill<SaveDiffMode>
      aria-label="Tracks shown"
      options={[
        { value: "changes", label: "Changes" },
        { value: "whole", label: "Whole set" },
      ]}
      value={state.mode}
      onValueChange={actions.setMode}
    />
  );
}

/** Steps through the tracks a save changed, one at a time, either way round. */
export function SaveDiffStepper() {
  const { state, actions } = useSaveDiffControls();
  if (state.changes === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        aria-label="Previous change"
        aria-keyshortcuts="["
        title="Previous change ["
        onClick={() => actions.stepBy(-1)}
      >
        <IconChevronLeft />
      </IconButton>
      <span
        aria-live="polite"
        className="min-w-[9ch] text-center text-micro text-ink-soft tabular-nums"
      >
        {state.step === 0
          ? pluralizeCount(state.changes, "change")
          : `${state.step} of ${state.changes}`}
      </span>
      <IconButton
        aria-label="Next change"
        aria-keyshortcuts="]"
        title="Next change ]"
        onClick={() => actions.stepBy(1)}
      >
        <IconChevronRight />
      </IconButton>
    </div>
  );
}
