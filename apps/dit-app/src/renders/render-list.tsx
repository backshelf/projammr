import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { Kbd } from "@workspace/ui/components/kbd";
import {
  SectionCount,
  sectionTitle,
} from "@workspace/ui/components/layout/section-head";

import { call } from "../bridge";
import type { RenderCard } from "../ipc";
import { useCommand } from "../use-command";
import { RenderCardView, type CardDecision } from "./render-card";
import { previewPlayer, toggleAudition, useReleasePreview } from "./preview";
import { AUDITION_SEEK_SECONDS } from "./preview-player";
import { isDecidable, mainFile, visibleCards } from "./render-model";

/**
 * The set screen's render band: "New bounce" over the waiting renders, nothing at all with none. A render the app is
 * still holding back (its minute of waiting) has no card yet.
 */
export function RenderBand({
  cards,
}: {
  cards: readonly RenderCard[];
}): JSX.Element | null {
  const shown = useMemo(() => visibleCards(cards), [cards]);
  if (shown.length === 0) return null;
  return <RenderList cards={shown} />;
}

/** The index the cursor stands at: its card if it is still there, else where it was (clamped) so a decided card hands the cursor on. */
function cursorIndex(
  cards: readonly RenderCard[],
  cursor: { id: number; index: number } | null
): number {
  if (cursor === null) return 0;
  const found = cards.findIndex((card) => card.id === cursor.id);
  return found >= 0 ? found : Math.min(cursor.index, cards.length - 1);
}

/**
 * The cards as a listbox that owns its keys: ↑/↓ move the cursor (with focus), `Y` adds the cursor's render as a
 * version, `N` turns it down as not a bounce, `Space` plays or pauses it and ←/→ step through the
 * file while it is loaded. The other turn-downs stay buttons. The options hold the decision buttons, so a key on one of
 * those buttons keeps its own meaning (Space presses the button).
 */
function RenderList({ cards }: { cards: readonly RenderCard[] }): JSX.Element {
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ id: number; index: number } | null>(
    null
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const { run, pending, error } = useCommand();
  const focusWasInRef = useRef(false);
  useReleasePreview();

  const index = cursorIndex(cards, cursor);
  const active = cards[index];

  const focusCard = useCallback((id: number) => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-render="${id}"]`)
      ?.focus();
  }, []);

  // A card decided away takes the focus with it; the cursor's next card takes it back, if the list had it.
  useEffect(() => {
    if (
      focusWasInRef.current &&
      (document.activeElement === document.body ||
        document.activeElement === null) &&
      active
    ) {
      focusCard(active.id);
    }
  }, [cards, active, focusCard]);

  const onCursor = useCallback(
    (id: number) => {
      const at = cards.findIndex((card) => card.id === id);
      if (at >= 0) setCursor({ id, index: at });
    },
    [cards]
  );

  const decide = useCallback(
    (card: RenderCard, decision: CardDecision) => {
      setBusyId(card.id);
      void run(() =>
        decision.kind === "accept"
          ? call("accept_render", {
              id: card.id,
              ...(decision.session === undefined
                ? {}
                : { session: decision.session }),
            })
          : call("reject_render", { id: card.id, mode: decision.mode })
      );
    },
    [run]
  );

  function moveTo(next: number): void {
    const target = cards[Math.max(0, Math.min(cards.length - 1, next))];
    if (!target) return;
    setCursor({ id: target.id, index: cards.indexOf(target) });
    focusCard(target.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // A popover's keys arrive here through React's tree, not the DOM's: they are not the list's.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!active) return;
    const onOption =
      (event.target as HTMLElement).getAttribute("role") === "option";
    const idle = !pending;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo(index - 1);
        return;
      case "Home":
        event.preventDefault();
        moveTo(0);
        return;
      case "End":
        event.preventDefault();
        moveTo(cards.length - 1);
        return;
      case "y":
      case "Y":
        if (isDecidable(active) && idle) {
          event.preventDefault();
          decide(active, { kind: "accept" });
        }
        return;
      case "n":
      case "N":
        if (isDecidable(active) && idle) {
          event.preventDefault();
          decide(active, { kind: "reject", mode: "not-a-bounce" });
        }
        return;
      case " ": {
        const file = mainFile(active);
        if (onOption && file) {
          event.preventDefault();
          void toggleAudition(file.path);
        }
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        const file = mainFile(active);
        if (
          onOption &&
          file &&
          previewPlayer.getSnapshot().filePath === file.path
        ) {
          event.preventDefault();
          previewPlayer.seekBy(
            event.key === "ArrowRight"
              ? AUDITION_SEEK_SECONDS
              : -AUDITION_SEEK_SECONDS
          );
        }
        return;
      }
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className={sectionTitle()}>
        New bounce
        {cards.length > 1 && <SectionCount>{cards.length}</SectionCount>}
      </h2>
      <div
        ref={listRef}
        role="listbox"
        aria-labelledby={headingId}
        aria-orientation="vertical"
        aria-keyshortcuts="ArrowUp ArrowDown Y N Space"
        onKeyDown={onKeyDown}
        onFocus={() => {
          focusWasInRef.current = true;
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next)) {
            focusWasInRef.current = false;
          }
        }}
        className="flex flex-col"
      >
        {cards.map((card, at) => (
          <RenderCardView
            key={card.id}
            card={card}
            active={at === index}
            busy={pending && busyId === card.id}
            error={busyId === card.id ? error : null}
            onCursor={onCursor}
            onDecide={decide}
          />
        ))}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-micro text-ink-faint">
        <Hint keys={"↑ ↓"} label="move" />
        <Hint keys="Y" label="add as version" />
        <Hint keys="N" label="not a bounce" />
        <Hint keys="Space" label="play" />
      </p>
    </section>
  );
}

function Hint({ keys, label }: { keys: string; label: string }): JSX.Element {
  return (
    <span>
      <Kbd variant="bare">{keys}</Kbd> {label}
    </span>
  );
}
