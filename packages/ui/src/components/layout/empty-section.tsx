"use client";

import { SectionArrival } from "@workspace/ui/components/layout/section-arrival";
import { sectionTitle } from "@workspace/ui/components/layout/section-head";
import {
  AnimatePresence,
  FADE,
  m,
  OPTICAL,
  SPRING,
} from "@workspace/ui/lib/motion";
import {
  hasRevealFocusRegion,
  revealFocusTarget,
} from "@workspace/ui/lib/reveal-focus";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";

const SectionRevealedContext = createContext(false);

/**
 * True inside a section the user has just opened from the add line, so the
 * content can open its own editing UI — a table's draft row — instead of
 * waiting for a second press.
 */
export const useSectionRevealed = () => use(SectionRevealedContext);

/** A quiet text action in `--art`, the shape every action on the add line
 *  takes. Takes any button props, so it can be the trigger of a dialog. */
export function SectionAction({
  className,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={"button"}
      className={cn(
        "rounded-sm text-small text-art outline-none hover:underline",
        "focus-visible:ring-2 focus-visible:ring-ring/30 coarse:min-h-11",
        className
      )}
      {...props}
    />
  );
}

/** A {@link SectionAction} that adds something: `+ Relation`, announced as
 *  "Add Relation". The children name the thing added. */
export function SectionAdd({ children, ...props }: ComponentProps<"button">) {
  return (
    <SectionAction {...props}>
      <span aria-hidden>+ </span>
      <span className={"sr-only"}>Add </span>
      {children}
    </SectionAction>
  );
}

/** One folded section's contribution to the add line. */
interface FoldEntry {
  id: string;
  /** Where the section sits in the page; the line follows this order. */
  anchor: Element;
  add?: string;
  addControl?: ReactNode;
  reveal: () => void;
}

const inDocumentOrder = (a: FoldEntry, b: FoldEntry) =>
  a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;

/**
 * The folded sections of one page, kept outside React state so a section
 * joining or leaving re-renders only the add line, not the page around it.
 * Entries are ordered by their anchors' document position, so a section that
 * resolves late inside a Suspense boundary still takes its place in the page
 * order.
 */
function createFoldStore() {
  let entries: readonly FoldEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => entries,
    set(entry: FoldEntry) {
      entries = [...entries.filter((e) => e.id !== entry.id), entry].sort(
        inDocumentOrder
      );
      emit();
    },
    remove(id: string) {
      if (!entries.some((e) => e.id === id)) return;
      entries = entries.filter((e) => e.id !== id);
      emit();
    },
  };
}

type FoldStore = ReturnType<typeof createFoldStore>;

const SectionFoldContext = createContext<FoldStore | null>(null);
const NO_ENTRIES: readonly FoldEntry[] = [];

function useFoldStore(consumer: string) {
  const store = use(SectionFoldContext);
  if (!store)
    throw new Error(`${consumer} must be rendered inside SectionFold`);
  return store;
}

/**
 * The scope of one page's add line: every {@link EmptySection} inside folds
 * its add actions into the {@link AddLine} placed inside the same scope.
 * Renders no element of its own, so the sections stay direct children of
 * their column.
 */
export function SectionFold({ children }: { children: ReactNode }) {
  const [store] = useState(createFoldStore);
  return <SectionFoldContext value={store}>{children}</SectionFoldContext>;
}

/**
 * One line gathering the add actions of every empty section in the page,
 * in page order, under a label naming the entity ("Add to this track").
 * Renders nothing when no section has anything to add.
 */
export function AddLine({ label }: { label: string }) {
  const store = useFoldStore("AddLine");
  const entries = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => NO_ENTRIES
  );
  const labelId = useId();

  if (entries.length === 0) return null;

  const actions = entries.flatMap((entry) => [
    ...(entry.add
      ? [
          {
            key: `${entry.id}:add`,
            node: <SectionAdd onClick={entry.reveal}>{entry.add}</SectionAdd>,
          },
        ]
      : []),
    ...(entry.addControl
      ? [{ key: `${entry.id}:control`, node: entry.addControl }]
      : []),
  ]);

  return (
    <div
      role={"group"}
      aria-labelledby={labelId}
      data-slot={"add-line"}
      className={"flex flex-wrap items-baseline gap-x-3 gap-y-1"}
    >
      <h2 id={labelId} className={cn(sectionTitle(), "mr-3")}>
        {label}
      </h2>
      <AnimatePresence initial={false}>
        {actions.map(({ key, node }, index) => (
          <m.span
            key={key}
            variants={OPTICAL}
            initial={"hidden"}
            animate={"shown"}
            exit={"leaving"}
            className={"contents"}
          >
            {index > 0 && (
              <span aria-hidden className={"text-small text-ink-soft"}>
                ·
              </span>
            )}
            {node}
          </m.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Moves focus into `root` once: to the region the content marked with
 * `REVEAL_FOCUS`, waiting for it to mount something focusable if it has not
 * yet (an editor that loads on demand), or else to the first focusable
 * control, or else to `root` itself. A control that already took focus as it
 * mounted keeps it, and so does anything the user moves focus to meanwhile;
 * `origin`, the add action that asked for the reveal, does not count as such.
 */
function useRevealFocus(root: HTMLElement | null, origin: Element | null) {
  useEffect(() => {
    if (!root) return;

    const focusMovedElsewhere = () => {
      const active = document.activeElement;
      return (
        active !== null &&
        active !== document.body &&
        active !== origin &&
        !root.contains(active)
      );
    };
    const settle = () => {
      if (root.contains(document.activeElement) || focusMovedElsewhere()) {
        return true;
      }
      const target = revealFocusTarget(root);
      if (target) {
        target.focus();
        return true;
      }
      if (!hasRevealFocusRegion(root)) {
        root.focus();
        return true;
      }
      return false;
    };

    if (settle()) return;
    const observer = new MutationObserver(() => {
      if (settle()) observer.disconnect();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["contenteditable"],
    });
    return () => observer.disconnect();
  }, [root, origin]);
}

/**
 * A page section that has nothing in it yet. While empty it renders nothing
 * in place and hands its add actions to the page's {@link AddLine}; pressing
 * `add` there renders the section's normal content — its own head, drop zone,
 * draft row or editor — here, in its own place, and moves focus into it. A
 * section with content renders that content as it is, inside the
 * {@link SectionArrival} every section on every page arrives with.
 *
 * `empty` is derived by the caller from the data the page already holds, so a
 * refresh that fills the section simply renders it and takes it off the line;
 * whether the user opened an empty one is the only state kept here.
 */
export function EmptySection({
  label,
  empty,
  add,
  addControl,
  emptyLabel,
  children,
}: {
  label: string;
  empty: boolean;
  /** What the add line offers to add ("Attachment"); pressing it reveals the
   *  content. Leave it out where the viewer cannot add anything. */
  add?: string;
  /** An action that adds without revealing the content in place, such as a
   *  `SectionAdd` that opens a dialog. It joins the add line as it is. */
  addControl?: ReactNode;
  /** For a section with nothing to add, a line said in its place instead of
   *  rendering nothing. */
  emptyLabel?: string;
  children: ReactNode;
}) {
  const store = useFoldStore("EmptySection");
  const id = useId();
  /** `null` until revealed; then the element focus was on when it was. */
  const [revealedFrom, setRevealedFrom] = useState<{
    origin: Element | null;
  } | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  /** True once the reveal's height/opacity animation has finished, so the
   *  overflow clip that keeps the height animation clean can be lifted — a
   *  focus ring or a popover inside the section must not stay clipped. */
  const [settled, setSettled] = useState(false);

  const reveal = useCallback(
    () => setRevealedFrom({ origin: document.activeElement }),
    []
  );

  useRevealFocus(root, revealedFrom?.origin ?? null);

  useEffect(() => {
    if (!anchor) return;
    store.set({ id, anchor, add, addControl, reveal });
  }, [store, id, anchor, add, addControl, reveal]);

  useEffect(() => {
    if (!anchor) return;
    return () => store.remove(id);
  }, [store, id, anchor]);

  if (revealedFrom) {
    return (
      <SectionRevealedContext value={true}>
        <SectionArrival>
          <m.div
            ref={setRoot}
            data-slot={"revealed-section"}
            tabIndex={-1}
            className={"outline-none"}
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: { height: SPRING.surface, opacity: FADE.move },
            }}
            style={{ overflow: settled ? undefined : "hidden" }}
            onAnimationComplete={() => setSettled(true)}
          >
            {children}
          </m.div>
        </SectionArrival>
      </SectionRevealedContext>
    );
  }

  if (!empty) return <SectionArrival>{children}</SectionArrival>;

  if (add !== undefined || addControl !== undefined) {
    return <span ref={setAnchor} hidden data-slot={"folded-section"} />;
  }

  if (emptyLabel === undefined) return null;

  return (
    <div
      data-slot={"empty-section"}
      className={"flex flex-wrap items-baseline gap-x-4 gap-y-1"}
    >
      <h2 className={sectionTitle()}>{label}</h2>
      <span className={"text-small text-ink-soft"}>{emptyLabel}</span>
    </div>
  );
}
