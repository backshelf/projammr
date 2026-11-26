"use client";

import { IconPlus } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A settings pane's list of colour rows: the section head carries the Add
 * control, which opens a one-line form at the top of the list. The rows are
 * `ColourItem`s, passed as children.
 */
export function ColourList({
  heading,
  noun,
  canEdit,
  empty,
  renderAddForm,
  children,
}: {
  heading: string;
  /** What Add makes, lower case: "status", "label". */
  noun: string;
  canEdit: boolean;
  empty: boolean;
  renderAddForm: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAddingRef = useRef(false);

  // Closing the form unmounts the field that held focus; put it back on the
  // control that opened it.
  useEffect(() => {
    if (wasAddingRef.current && !adding) addButtonRef.current?.focus();
    wasAddingRef.current = adding;
  }, [adding]);

  return (
    <section>
      <SectionHead
        action={
          canEdit ? (
            <Button
              ref={addButtonRef}
              variant="ghost"
              size="icon-sm"
              className="text-ink-soft"
              aria-label={`Add ${noun}`}
              aria-expanded={adding}
              onClick={() => setAdding(true)}
            >
              <IconPlus size={14} />
            </Button>
          ) : undefined
        }
      >
        {heading}
      </SectionHead>
      {empty && !adding && (
        <Empty className="border-0 py-8">
          <EmptyHeader>
            <EmptyTitle>
              {canEdit
                ? `No ${noun}s yet. Add one to get started.`
                : `No ${noun}s yet.`}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <Rows as="ul" className="gap-1">
        {adding && <li>{renderAddForm(() => setAdding(false))}</li>}
        {children}
      </Rows>
    </section>
  );
}
