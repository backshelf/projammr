"use client";

import type { RowData } from "@tanstack/react-table";
import { useSectionRevealed } from "@workspace/ui/components/layout/empty-section";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { useDataTable } from "../data-table-context";
import { DraftRow, type NewRowConfig } from "../DraftRow";
import type { Section } from "../group-sections";

/**
 * The draft slices the toggle under the grid, the ungrouped draft row and every
 * section's "+ Add" share. The root calls it once and hands the result to its
 * parts as `draft`.
 *
 * The draft row stays out of the way until someone asks to add a row: by the
 * toggle, or by the `+ Add …` that opened the section the table sits in.
 */
export function useDraft() {
  const openedToAdd = useSectionRevealed();
  const [drafting, setDrafting] = useState(openedToAdd);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeDraft = useCallback(() => {
    setDrafting(false);
    toggleRef.current?.focus();
  }, []);
  const toggleDraft = useCallback(
    () => (drafting ? closeDraft() : setDrafting(true)),
    [drafting, closeDraft]
  );

  // The one group section (if any) currently showing its seeded draft row.
  const [addingInGroup, setAddingInGroup] = useState<string | null>(null);

  // The section whose rows carry `layout`. Motion moves a row from the layout
  // it measured on an earlier render, so a section arms its rows as the
  // pointer reaches its "+ Add" button and holds them armed until the draft
  // has gone again.
  const [settleSection, setSettleSection] = useState<string | null>(null);
  const armSection = useCallback((key: string) => setSettleSection(key), []);
  const disarmSection = useCallback(
    (key: string) =>
      setSettleSection((current) => (current === key ? null : current)),
    []
  );

  return useMemo(
    () => ({
      drafting,
      toggleRef,
      closeDraft,
      toggleDraft,
      addingInGroup,
      setAddingInGroup,
      settleSection,
      armSection,
      disarmSection,
    }),
    [
      drafting,
      closeDraft,
      toggleDraft,
      addingInGroup,
      settleSection,
      armSection,
      disarmSection,
    ]
  );
}

/** What `useDraft` returns. */
export type DraftState = ReturnType<typeof useDraft>;

/**
 * The draft field and value a "+ Add" under one group's header seeds, or null
 * when the table cannot add, the grouping cannot seed a create, or the section
 * is the ungrouped remainder.
 */
export function sectionSeed(
  newRow: NewRowConfig | undefined,
  activeGroupKey: string | null,
  sectionKey: string
) {
  if (!newRow?.groupSeed || !activeGroupKey || sectionKey === "__none__") {
    return null;
  }
  return newRow.groupSeed(activeGroupKey, sectionKey);
}

/**
 * The toggle under the grid that opens and closes the ungrouped draft row.
 * Absent for a viewer, who has no `newRow`, and on the card tier.
 */
export function Draft<TData extends RowData, TChild = never>(): ReactNode {
  const { newRow, showCards, entityLabel, draft } = useDataTable<
    TData,
    TChild
  >();
  if (!newRow || showCards) return null;
  const { drafting, toggleRef, toggleDraft } = draft;

  return (
    <div className="sticky left-0 px-2 pt-2">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={drafting}
        className="text-small text-art hover:underline coarse:min-h-11"
        onClick={toggleDraft}
      >
        {drafting ? "Cancel" : `+ Add ${entityLabel}`}
      </button>
    </div>
  );
}

/**
 * The ungrouped draft row. It renders beside the body in a grouped table too,
 * where the toggle under the grid still opens it.
 */
export function DraftTableRow<
  TData extends RowData,
  TChild = never,
>(): ReactNode {
  const { table, newRow, pinnedColumnId, draft } = useDataTable<
    TData,
    TChild
  >();
  const { drafting, closeDraft } = draft;

  return (
    <AnimatePresence initial={false}>
      {newRow && drafting && (
        <DraftRow
          key="draft"
          config={newRow}
          columnIds={table.getVisibleLeafColumns().map((c) => c.id)}
          pinnedColumnId={pinnedColumnId}
          autoFocus
          onCancel={closeDraft}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * A draft row seeded with `section`'s group, open under its header while
 * `addingInGroup` names the section.
 */
export function SeededDraftRow<TData extends RowData, TChild = never>({
  section,
}: {
  section: Section<unknown>;
}): ReactNode {
  const { table, newRow, pinnedColumnId, activeGroupKey, draft } = useDataTable<
    TData,
    TChild
  >();
  const { addingInGroup, setAddingInGroup, disarmSection } = draft;
  const seed = sectionSeed(newRow, activeGroupKey, section.key);

  return (
    <AnimatePresence
      initial={false}
      onExitComplete={() => disarmSection(section.key)}
    >
      {addingInGroup === section.key && seed && newRow && (
        <DraftRow
          key={`draft:${section.key}`}
          config={newRow}
          columnIds={table.getVisibleLeafColumns().map((c) => c.id)}
          pinnedColumnId={pinnedColumnId}
          initialValues={{ [seed.field]: seed.value }}
          lockedFields={[seed.field]}
          onCreated={() => setAddingInGroup(null)}
        />
      )}
    </AnimatePresence>
  );
}
