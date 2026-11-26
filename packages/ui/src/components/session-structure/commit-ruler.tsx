"use client";

import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import {
  brushed,
  type Compare,
  compareOf,
  compareOfBrush,
  lanesOf,
  navigable,
  placeOf,
  rulerSpan,
  rulerStates,
  type RulerCommit,
  type RulerSave,
  type RulerState,
  step,
} from "@workspace/ui/lib/commit-ruler";
import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import { positionOf, timeRuler } from "@workspace/ui/lib/ruler-scale";
import { cn } from "@workspace/ui/lib/utils";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useMemo,
  useRef,
  useId,
  useState,
} from "react";

/** How far (as a share of the track's width) a pointer must travel before a press is a drag, not a click. */
const DRAG_THRESHOLD_PX = 6;

/** How far past the edge of a drag a mark still counts as inside it, so a brush that starts on a mark takes it. */
const MARK_REACH_PX = 8;

/** The mark a state draws as: a commit full strength, a checkpoint lighter, a save the faintest tick. */
const MARK = {
  commit: "size-2.5 rounded-full bg-art",
  checkpoint: "size-2 rounded-full bg-art/35",
} as const;

function Mark({
  state,
  left,
  active,
  anchored,
  marked,
  onChoose,
  onFocus,
  register,
  inert,
}: {
  state: RulerState;
  left: number;
  active: boolean;
  anchored: boolean;
  marked: "from" | "to" | null;
  onChoose: (state: RulerState, extend: boolean) => void;
  onFocus: (state: RulerState) => void;
  register: (key: string, node: HTMLButtonElement | null) => void;
  /** A tick under the commits it would otherwise cover: shown, never pressed. */
  inert: boolean;
}) {
  const kind = state.kind === "save" ? "save" : state.kind;
  if (inert) {
    return (
      <span
        aria-hidden="true"
        data-state={state.key}
        data-kind={kind}
        className="pointer-events-none absolute top-1/2 z-0 flex size-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        style={{ left: `${left}%` }}
      >
        <span className="block h-2 w-px bg-ink/30" />
      </span>
    );
  }
  return (
    <button
      ref={(node) => register(state.key, node)}
      type="button"
      title={state.title}
      aria-label={state.title}
      aria-pressed={anchored || marked != null}
      tabIndex={active ? 0 : -1}
      data-state={state.key}
      data-kind={kind}
      data-marked={marked ?? undefined}
      onClick={(event) => onChoose(state, event.shiftKey)}
      onFocus={() => onFocus(state)}
      className={cn(
        // The hit area grows to 44px under a coarse pointer without the mark growing.
        "group/mark absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none",
        "coarse:size-11 coarse:after:absolute coarse:after:inset-0 coarse:after:content-['']",
        "fine:size-3",
        // Where marks crowd, a commit sits over a checkpoint and both over the ticks.
        state.kind === "commit"
          ? "z-20"
          : state.kind === "checkpoint"
            ? "z-10"
            : "z-0"
      )}
      style={{ left: `${left}%` }}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block motion-ink",
          state.kind === "save"
            ? "h-2 w-px bg-ink/30"
            : MARK[state.kind as keyof typeof MARK],
          "group-hover/mark:bg-ink group-focus-visible/mark:ring-2 group-focus-visible/mark:ring-ink",
          (anchored || marked) && "ring-2 ring-ink"
        )}
      />
    </button>
  );
}

/**
 * The commit ruler: the session's history on a time axis from its first save
 * to now, one lane per machine (a single lane on a phone), every save a faint
 * tick, every commit a mark and checkpoints lighter. It is drawn over
 * `lib/ruler-scale.ts`'s `RulerConfig` and `positionOf` with the `timeRuler`
 * preset, as the loudness and tempo scales are over theirs.
 *
 * It does three things. **Reveal**: a click on a mark names it in the log
 * (`onReveal` with the row's id). **Compare**: drag across the marks to take
 * the oldest and newest inside, or click one and shift-click another (or Enter
 * on each, with the keyboard) and `onCompare` gets the two saves. **Clear**
 * (Esc) calls `onClear`. Arrow keys, Home and End move between marks; one tab
 * stop, as a toolbar has. The marks are 44px targets under `coarse:`.
 *
 * Router-free: what a reveal or a compare does is the caller's.
 */
export function CommitRuler({
  commits,
  saves,
  marked,
  format,
  asOf,
  onReveal,
  onCompare,
  onClear,
  className,
}: {
  /** The loaded commits, newest first as the route answers them. */
  commits: readonly RulerCommit[];
  saves: readonly RulerSave[];
  /** The two saves of the compare that is open, if one is. */
  marked?: { from?: number | null; to?: number | null };
  format?: Formatters;
  /** What "now" is, so the axis ends there; fix it at mount so hydration agrees. */
  asOf: Date;
  onReveal: (rowId: string) => void;
  onCompare: (compare: Compare) => void;
  onClear: () => void;
  className?: string;
}) {
  const formats = format ?? defaultFormatters();
  const helpId = useId();
  const coarse = useCoarsePointer();
  const lastPointerTypeRef = useRef<string | null>(null);

  const states = useMemo(
    () =>
      rulerStates({
        commits,
        saves,
        describe: ({ kind, at, machine, message, author }) => {
          const when = formats.dateTime(at);
          if (kind === "save") {
            return [`Save`, machine, when].filter(Boolean).join(" · ");
          }
          const label = kind === "checkpoint" ? "Checkpoint" : message;
          return [label, author, machine, when].filter(Boolean).join(" · ");
        },
      }),
    [commits, saves, formats]
  );
  const lanes = useMemo(() => lanesOf(states), [states]);
  const [from, to] = useMemo(
    () => rulerSpan(states, asOf.getTime()),
    [states, asOf]
  );
  const config = useMemo(
    () => timeRuler(from, to, formats),
    [from, to, formats]
  );
  const moves = useMemo(() => navigable(states), [states]);

  const [anchor, setAnchor] = useState<RulerState | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const [announced, setAnnounced] = useState("");

  const nodesRef = useRef(new Map<string, HTMLButtonElement>());
  const register = (key: string, node: HTMLButtonElement | null) => {
    if (node) nodesRef.current.set(key, node);
    else nodesRef.current.delete(key);
  };
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; pct: number; moved: boolean } | null>(
    null
  );

  // One tab stop: the state last focused, else the newest.
  const active = moves.find((state) => state.key === activeKey) ?? moves.at(-1);

  const markedEnd = (state: RulerState): "from" | "to" | null =>
    marked?.from === state.saveId
      ? "from"
      : marked?.to === state.saveId
        ? "to"
        : null;

  const compare = (a: RulerState, b: RulerState) => {
    const result = compareOf(a, b);
    setAnchor(null);
    setAnnounced(`Comparing ${a.title} with ${b.title}`);
    onCompare(result);
  };

  /** A press on a mark: on desktop, a plain click reveals the row and anchors
   *  a compare while shift-click closes it; on touch/coarse pointers, tapping
   *  a first mark anchors it and tapping a second mark compares the pair. */
  const choose = (state: RulerState, extend: boolean) => {
    setActiveKey(state.key);
    const isTouch = coarse || lastPointerTypeRef.current === "touch";
    lastPointerTypeRef.current = null;
    if ((extend || isTouch) && anchor && anchor.key !== state.key) {
      compare(anchor, state);
      return;
    }
    if (isTouch && anchor && anchor.key === state.key) {
      setAnchor(null);
      setAnnounced("Selection cleared");
      return;
    }
    setAnchor(state);
    setAnnounced(
      isTouch
        ? `From ${state.title}. Tap another mark to compare.`
        : `From ${state.title}. Shift-click or press Enter on another to compare.`
    );
    onReveal(state.rowId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setAnchor(null);
      setBrush(null);
      setAnnounced("Compare cleared");
      onClear();
      return;
    }
    const target = states.find((state) => state.key === activeKey) ?? active;
    const move =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
    if (move != null) {
      event.preventDefault();
      const next = step(moves, target?.key ?? null, move);
      if (next) {
        setActiveKey(next.key);
        nodesRef.current.get(next.key)?.focus();
      }
      return;
    }
    if (event.key === "Enter" && target) {
      // Enter sets From, then To; a button's own click would only name the row.
      event.preventDefault();
      if (anchor && anchor.key !== target.key) compare(anchor, target);
      else {
        setAnchor(target);
        setAnnounced(
          `From ${target.title}. Press Enter on another mark for To.`
        );
      }
    }
  };

  const xPct = (clientX: number): number => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    lastPointerTypeRef.current = event.pointerType;
    if (event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      pct: xPct(event.clientX),
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = dragRef.current;
    if (!press) return;
    if (!press.moved) {
      if (Math.abs(event.clientX - press.x) < DRAG_THRESHOLD_PX) return;
      press.moved = true;
      // Captured only once it is a drag, so a plain press still clicks the mark under it.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setBrush([press.pct, xPct(event.clientX)]);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const press = dragRef.current;
    dragRef.current = null;
    if (!press?.moved) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const end = xPct(event.clientX);
    setBrush(null);
    const width = trackRef.current?.getBoundingClientRect().width || 1;
    const pad = (MARK_REACH_PX / width) * 100;
    const result = compareOfBrush(states, config, press.pct, end, pad);
    if (result) {
      setAnchor(null);
      const inside = brushed(states, config, press.pct, end, pad);
      setAnnounced(
        `Comparing ${inside[0]!.title} with ${inside.at(-1)!.title}`
      );
      onCompare(result);
    }
  };

  if (states.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Commit ruler"
      aria-orientation="horizontal"
      aria-describedby={helpId}
      onKeyDown={onKeyDown}
      className={cn(
        "flex flex-col gap-1 [--lane-h:1.75rem] coarse:[--lane-h:2.75rem]",
        className
      )}
      style={{ "--lanes": lanes.length } as CSSProperties}
    >
      <p id={helpId} className="sr-only">
        Arrow keys move between commits. Enter sets From, then To. Escape clears
        the comparison.
      </p>
      <p role="status" className="sr-only">
        {announced}
      </p>
      <div className="flex gap-3">
        {/* Machine names, one per lane; a phone has one lane and no names. */}
        <ul aria-hidden className="flex w-24 shrink-0 flex-col phone:hidden">
          {lanes.map((lane) => (
            <li
              key={lane.machine ?? "unknown"}
              className="flex h-(--lane-h) items-center truncate text-micro text-ink-soft"
            >
              {lane.machine ?? "Unknown machine"}
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
              setBrush(null);
            }}
            className={cn(
              "relative touch-pan-y select-none",
              // One lane per machine, or one track altogether on a phone.
              "h-[calc(var(--lanes)*var(--lane-h))] phone:h-(--lane-h)"
            )}
          >
            {lanes.map((lane, index) => (
              <div
                key={lane.machine ?? "unknown"}
                className={cn(
                  "absolute inset-x-0 h-(--lane-h) border-b border-rule",
                  "phone:top-0! phone:border-b-0"
                )}
                style={{ top: `calc(${index} * var(--lane-h))` }}
              >
                {lane.states.map((state) => (
                  <Mark
                    key={state.key}
                    state={state}
                    left={placeOf(state, config)}
                    active={state.key === active?.key}
                    anchored={anchor?.key === state.key}
                    marked={markedEnd(state)}
                    onChoose={choose}
                    onFocus={(focused) => setActiveKey(focused.key)}
                    register={register}
                    inert={
                      state.kind === "save" &&
                      moves.some((m) => m.kind !== "save")
                    }
                  />
                ))}
              </div>
            ))}
            {brush && (
              <i
                aria-hidden
                className="pointer-events-none absolute inset-y-0 bg-art/15"
                style={{
                  left: `${Math.min(brush[0], brush[1])}%`,
                  width: `${Math.abs(brush[1] - brush[0])}%`,
                }}
              />
            )}
          </div>
          <div aria-hidden className="relative h-5 border-t border-rule-strong">
            {config.stops.map((stop, i) => (
              <span
                key={stop}
                className={cn(
                  "absolute top-1 text-micro whitespace-nowrap text-ink-soft tabular-nums",
                  // A phone has room for the ends and the middle only.
                  i % 2 === 1 && "phone:hidden",
                  i === 0
                    ? "translate-x-0"
                    : i === config.stops.length - 1
                      ? "-translate-x-full"
                      : "-translate-x-1/2"
                )}
                style={{ left: `${positionOf(stop, config.min, config.max)}%` }}
              >
                {config.format(stop)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
