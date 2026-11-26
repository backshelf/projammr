"use client";

import { useDataTable } from "@/components/tables/data-table-context";
import { resolvePeek, stepPeek } from "@/lib/peek-param";
import type { RowData } from "@tanstack/react-table";
import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

// The panel is dead weight until a row is opened, so it is split into its own
// chunk. `next/dynamic` fetches on first render, which is why `Peek` withholds
// the render until a row opens.
const PeekPanel = dynamic(
  () => import("@/components/tables/PeekPanel").then((m) => m.PeekPanel),
  { ssr: false }
);

/**
 * The table's peek panel. A table without a `peek` config renders nothing and
 * never fetches the panel's chunk; one with it mounts the panel the first time
 * a row is opened and keeps it mounted, so closing can animate out.
 */
export function Peek<TData extends RowData, TChild = never>(): ReactNode {
  const {
    table,
    peek,
    peekId,
    setPeekId,
    renaming,
    setRenaming,
    handleCellSave,
    entityLabel,
    loaded,
    ensureLoaded,
    scrollToIndex,
  } = useDataTable<TData, TChild>();

  // One-way: set the first render that has a row open, never cleared.
  const [opened, setOpened] = useState(false);
  if (peek && peekId != null && !opened) setOpened(true);

  const pageRows = table.getRowModel().rows;

  // Rows the panel can step through: top-level rows of the current page in
  // the order they are displayed. Prev/next walk this, so they follow the
  // active sort, filters and grouping.
  const peekableRows = useMemo(() => {
    if (!peek) return [];
    return pageRows
      .filter((row) => row.depth === 0)
      .map((row) => row.original as TData & { id: number });
  }, [peek, pageRows]);

  const resolvedPeek = useMemo(
    () => resolvePeek(peekableRows, peekId),
    [peekableRows, peekId]
  );

  // The `peekableRows` index a Next-past-the-window load is waiting to land
  // on. `ensureLoaded` resolving only guarantees the row exists in state;
  // `peekableRows` itself does not carry it until the resulting render
  // reaches this component, so the step is resolved by index in the effect
  // below rather than off a `peekableRows` array read straight after the
  // `await` (mirrors `use-row-cursor.ts`'s `pendingIndex`).
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [nextLoading, setNextLoading] = useState(false);

  useEffect(() => {
    if (pendingIndex == null) return;
    const targetRow = peekableRows[pendingIndex];
    if (!targetRow) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect
    setPendingIndex(null);
    setPeekId(targetRow.id);
  }, [pendingIndex, peekableRows, setPeekId]);

  // Keeps the grid's virtualised window aligned with the panel: whenever the
  // peeked row changes, scroll it into view. `scrollToIndex` counts the
  // table's whole row model (`pageRows`), not `peekableRows`, so the row is
  // found there by id; a no-op while the grid holds no virtualiser (the card
  // tier, or an empty table). The rows are read through a ref rather than
  // depended on: a page appending while the user scrolls the grid must not
  // re-run this and yank them back to the peeked row.
  const pageRowsRef = useRef(pageRows);
  useEffect(() => {
    pageRowsRef.current = pageRows;
  });
  useEffect(() => {
    if (peekId == null) return;
    const index = pageRowsRef.current.findIndex(
      // Top-level rows only: an expanded child can share the peeked row's id.
      (row) =>
        row.depth === 0 &&
        (row.original as TData & { id: number }).id === peekId
    );
    if (index !== -1) scrollToIndex.current?.(index);
  }, [peekId, scrollToIndex]);

  if (!peek || !opened) return null;

  const previousStep = stepPeek(peekableRows, resolvedPeek.index, -1, {
    hasMore: false,
  });
  const previousId = previousStep === "load" ? null : previousStep;

  const nextStep = stepPeek(peekableRows, resolvedPeek.index, 1, {
    hasMore: loaded.hasMore,
  });
  const onNext =
    nextStep === "load"
      ? async () => {
          setNextLoading(true);
          // `peekableRows` is top-level rows only (`pageRows` filtered to
          // depth 0). `ensureLoaded` measures the row model as a whole, which
          // can hold more rows than `peekableRows` while a parent is
          // expanded, so it is given the row model's own length; `pendingIndex`
          // still resolves against `peekableRows`, the array it is looked up in.
          const targetIndex = peekableRows.length;
          const ok = await ensureLoaded(pageRows.length);
          setNextLoading(false);
          // A stale pending index left set by an earlier call must not fire on
          // a later, unrelated `peekableRows` change once this one comes back
          // empty.
          setPendingIndex(ok ? targetIndex : null);
        }
      : nextStep != null
        ? () => setPeekId(nextStep)
        : null;

  return (
    <PeekPanel
      row={resolvedPeek.row ? peek.toPeekRow(resolvedPeek.row) : null}
      href={resolvedPeek.row ? peek.href(resolvedPeek.row) : "#"}
      entityLabel={entityLabel}
      onClose={() => setPeekId(null)}
      position={
        resolvedPeek.index >= 0
          ? { index: resolvedPeek.index + 1, total: resolvedPeek.total }
          : undefined
      }
      onPrevious={previousId != null ? () => setPeekId(previousId) : null}
      onNext={onNext}
      nextLoading={nextLoading}
      rename={{
        active: renaming,
        onSave: async (title) =>
          resolvedPeek.row != null &&
          (await handleCellSave(resolvedPeek.row.id, peek.titleField, title)),
        onEnd: () => setRenaming(false),
      }}
    />
  );
}
