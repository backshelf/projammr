"use client";

import { StatusMenuList } from "@/components/status/components/StatusMenu";
import type { Status as StatusType } from "@workspace/api/api";
import { StatusDisplay } from "@/components/status/StatusDisplay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import type { RefCallback } from "react";

export interface StatusCellProps {
  statuses: StatusType[];
  /** The current statusId (number) or null */
  value: number | null;
  onSave: (value: number | null) => void;
  /**
   * A form row's field id and invalid state, and the ids of its label and
   * hint/error text, so both attach to the trigger.
   */
  id?: string;
  invalid?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  onBlur?: () => void;
  ref?: RefCallback<HTMLElement>;
}

/**
 * Inline-editable table cell for selecting a status. Shows the current status
 * as the table's tinted chip and opens the status menu on click.
 */
export function StatusCell({
  statuses,
  value,
  onSave,
  id,
  invalid,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  onBlur,
  ref,
}: StatusCellProps) {
  const currentStatus = value ? statuses.find((s) => s.id === value) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        nativeButton={false}
        onBlur={onBlur}
        ref={ref}
      >
        {/* `data-cell-control`: inside a table grid this element is the cell's
            own control, so a press on it is the cell's to answer and the
            keyboard opens the menu by clicking it. */}
        <div
          data-cell-control
          id={id}
          aria-invalid={invalid || undefined}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          className="inline-block w-full cursor-pointer"
        >
          {currentStatus ? (
            <StatusDisplay status={currentStatus} variant="chip" />
          ) : (
            <span className="inline-block text-small text-ink-soft">
              — none —
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="overflow-visible p-0">
        <StatusMenuList
          statuses={statuses}
          currentId={value}
          onPick={(status) => onSave(status.id)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
