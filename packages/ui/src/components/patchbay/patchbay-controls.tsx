"use client";

import { FloatingNote } from "@workspace/ui/components/floating-note";
import { Popover, PopoverContent } from "@workspace/ui/components/popover";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { isTypingTarget } from "@workspace/ui/lib/keymap";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/** What the note says of the node it is anchored to, read off the node's own
 *  text so the leaf never needs the data. */
type Note = { anchor: HTMLElement; label: string; meta: string | null };

/** What holds a node lit, strongest first: a pin, the pointer, focus. */
type Holds = {
  pinned: HTMLElement | null;
  hover: HTMLElement | null;
  focus: HTMLElement | null;
  /** A mouse button is down, so the focus it causes is not a step. */
  pressing: boolean;
};

type Side = "left" | "right";

const NODE = "[data-pb-node]";

function nodeOf(target: EventTarget | null): HTMLElement | null {
  return (target as Element | null)?.closest?.<HTMLElement>(NODE) ?? null;
}

/** A rail's nodes in the order they are laid out. */
function railNodes(scope: ParentNode, side: Side): HTMLElement[] {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      `[data-pb-rail="${side}"] > ${NODE}`
    ),
  ];
}

/** What holds a node lit: a pin, else the pointer, else focus. */
function strongest({ pinned, hover, focus }: Holds): HTMLElement | null {
  return [pinned, hover, focus].find((node) => node?.isConnected) ?? null;
}

/** Whether a cable's `"{leftId}|{rightId}"` joins this node to another, and
 *  that other node's id. Right ids are paths and may hold a `|`, so the
 *  value is cut at the node's own id rather than split. */
function neighbourOf(
  cable: string,
  id: string,
  side: string | null,
  others: Set<string>
): string | null {
  const rest =
    side === "left"
      ? cable.startsWith(`${id}|`)
        ? cable.slice(id.length + 1)
        : null
      : cable.endsWith(`|${id}`)
        ? cable.slice(0, -(id.length + 1))
        : null;
  return rest !== null && others.has(rest) ? rest : null;
}

function clear(root: HTMLElement) {
  for (const element of root.querySelectorAll("[data-hot]")) {
    element.removeAttribute("data-hot");
  }
  root.removeAttribute("data-dim");
}

/** Writes the lit state onto the drawing: `data-hot` on a node, its cables
 *  and its neighbours, `data-dim` on the root so the rest fades. */
function light(root: HTMLElement, node: HTMLElement | null) {
  clear(root);
  if (!node) return;

  const id = node.getAttribute("data-pb-node") ?? "";
  const side = node.getAttribute("data-pb-side");
  const nodes = [...root.querySelectorAll<HTMLElement>(NODE)];
  const others = new Set(
    nodes
      .filter((other) => other.getAttribute("data-pb-side") !== side)
      .map((other) => other.getAttribute("data-pb-node") ?? "")
  );

  const neighbours = new Set<string>();
  root.setAttribute("data-dim", "");
  node.setAttribute("data-hot", "");
  for (const cable of root.querySelectorAll("[data-pb-cable]")) {
    const other = neighbourOf(
      cable.getAttribute("data-pb-cable") ?? "",
      id,
      side,
      others
    );
    if (other === null) continue;
    cable.setAttribute("data-hot", "");
    neighbours.add(other);
  }
  for (const other of nodes) {
    if (
      other.getAttribute("data-pb-side") !== side &&
      neighbours.has(other.getAttribute("data-pb-node") ?? "")
    ) {
      other.setAttribute("data-hot", "");
    }
  }
}

function noteOf(node: HTMLElement): Note {
  return {
    anchor: node,
    label: node.querySelector("[data-pb-label]")?.textContent ?? "",
    meta: node.querySelector("[data-pb-meta]")?.textContent ?? null,
  };
}

function NoteBody({ note }: { note: Note }) {
  return (
    <div className="flex max-w-72 flex-col gap-0.5 px-3 py-2 text-small break-all">
      <span className="text-ink">{note.label}</span>
      {note.meta && (
        <span className="text-micro text-ink-soft">{note.meta}</span>
      )}
    </div>
  );
}

/**
 * The client half of a patchbay, wrapped around the drawing the server
 * rendered: `<PatchbayControls><Patchbay … /></PatchbayControls>`. It receives
 * no data. Every node and cable carries its ids, which is all it needs to
 * light a node, its cables and its neighbours (`data-hot`) and fade the rest
 * (`data-dim` on the root, where the drawing's own classes read it), so the
 * pointer never re-renders the drawing.
 *
 * Hover (a mouse only), focus and click light a node. A click pins it: the
 * pin outranks hover and focus until a second click or Escape lets go. `[`
 * and `]` walk the left rail and then the right, in the order they are laid
 * out, and carry a pin along. A fine pointer shows the lit node's full label
 * and meta in a `FloatingNote`; a coarse one has no hover to read it, so a tap
 * opens the same words in a popover.
 */
export function PatchbayControls({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();
  const holdsRef = useRef<Holds>({
    pinned: null,
    hover: null,
    focus: null,
    pressing: false,
  });
  const [note, setNote] = useState<Note | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  /** Writes whichever node holds strongest onto the drawing. */
  const paint = () => {
    const root = wrapRef.current?.querySelector<HTMLElement>("[data-pb-root]");
    if (root) light(root, strongest(holdsRef.current));
  };

  /** Lights whichever node holds strongest, and points the note at it. */
  const sync = () => {
    paint();
    const lit = strongest(holdsRef.current);
    if (lit) setNote((prev) => (prev?.anchor === lit ? prev : noteOf(lit)));
    setNoteOpen(lit !== null);
  };

  // A server render of the drawing reuses its nodes and cables, which keep
  // the attributes the last lighting wrote.
  useEffect(paint, [children]);

  const step = (from: HTMLElement | null, delta: 1 | -1) => {
    const root = wrapRef.current;
    if (!root) return;
    const nodes = [...railNodes(root, "left"), ...railNodes(root, "right")];
    if (nodes.length === 0) return;
    const at = from ? nodes.indexOf(from) : -1;
    const to =
      at === -1
        ? delta > 0
          ? 0
          : nodes.length - 1
        : (at + delta + nodes.length) % nodes.length;
    const next = nodes[to]!;
    (next.querySelector<HTMLElement>("a") ?? next).focus({
      preventScroll: true,
    });
    // A key is pressed over and over; its step lands at once.
    next.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (holdsRef.current.pinned) {
      holdsRef.current.pinned = next;
      sync();
    }
  };

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || coarse) return;
    holdsRef.current.hover = nodeOf(event.target);
    sync();
  };

  const onPointerLeave = () => {
    holdsRef.current.hover = null;
    sync();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    holdsRef.current.pressing = event.pointerType === "mouse";
    if (!holdsRef.current.pressing) return;
    // A press released outside the wrapper never reaches its own pointerup,
    // and a stuck press would keep every later keyboard focus unlit.
    const released = new AbortController();
    const release = () => {
      holdsRef.current.pressing = false;
      released.abort();
    };
    window.addEventListener("pointerup", release, { signal: released.signal });
    window.addEventListener("pointercancel", release, {
      signal: released.signal,
    });
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    // Clicking a node focuses it, and the click pins it; focus alone would
    // keep a node the click just let go of lit.
    if (holdsRef.current.pressing) return;
    holdsRef.current.focus = nodeOf(event.target);
    sync();
  };

  const onBlur = () => {
    holdsRef.current.focus = null;
    sync();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const node = nodeOf(event.target);
    if (!node) return;
    if (holdsRef.current.pinned === node) {
      // Letting go also drops the focus the tap gave the node: a touch focuses
      // after its pointer is up, so `pressing` never kept that focus out.
      holdsRef.current.pinned = null;
      holdsRef.current.focus = null;
    } else {
      holdsRef.current.pinned = node;
    }
    sync();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "Escape") {
      if (!holdsRef.current.pinned && !noteOpen) return;
      holdsRef.current.pinned = null;
      sync();
      // What lights on hover or focus goes on lighting; the note is what
      // Escape dismisses.
      setNoteOpen(false);
      return;
    }
    if (event.key === "]" || event.key === "[") {
      event.preventDefault();
      step(nodeOf(event.target), event.key === "]" ? 1 : -1);
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={-1}
      className={cn("relative outline-none", className)}
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={() => {
        holdsRef.current.pressing = false;
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
      {coarse ? (
        <Popover
          open={noteOpen}
          onOpenChange={(open, details) => {
            if (open) return;
            // A tap on a node is its own click, which pins or lets go.
            if (
              details.reason === "outside-press" &&
              nodeOf(details.event.target)
            ) {
              return;
            }
            holdsRef.current.pinned = null;
            sync();
            setNoteOpen(false);
          }}
        >
          {note && (
            <PopoverContent
              anchor={note.anchor}
              aria-label={note.label}
              initialFocus={false}
              finalFocus={false}
              className="w-auto max-w-72 gap-0 p-0"
            >
              <NoteBody note={note} />
            </PopoverContent>
          )}
        </Popover>
      ) : (
        <AnimatePresence>
          {noteOpen && note && (
            <FloatingNote
              key="patchbay-note"
              anchor={note.anchor}
              placement="above"
            >
              <NoteBody note={note} />
            </FloatingNote>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
