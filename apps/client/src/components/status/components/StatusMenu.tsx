"use client";

import { StatusDisplayType } from "@/components/status/StatusDisplay";
import { FloatingNote } from "@workspace/ui/components/floating-note";
import {
  ResponsivePickerItem,
  ResponsivePickerList,
} from "@workspace/ui/components/responsive-picker";
import { Meter } from "@workspace/ui/components/table";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { CSSProperties, useMemo, useState } from "react";

/**
 * Picking a status is picking a position in the pipeline, so the menu is built
 * like a channel strip rather than a list of tags: every status owns a
 * full-bleed row, identified by a colour rail down its edge, and the rows stack
 * flush against one another. The row body stays paper-and-ink, which keeps the
 * name legible whatever colour the user picked.
 *
 * The host sets --status per row, the same variable the pill and chip read.
 */
const statusMenu = "flex flex-col divide-y-0 overflow-hidden rounded-[inherit]";

/** The colour rail runs the full height of the row, flush to the leading edge,
 *  and is the only place the status colour appears at full strength. It widens
 *  on hover, and stays widened on the row the entity is already in. */
const statusMenuItem = cn(
  "relative w-full cursor-pointer items-center gap-3 px-3 py-2 pl-4 text-left text-body/[1.2] text-ink motion-settle",
  "[&+&]:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ink)_8%,transparent)]",
  "hover:bg-[color-mix(in_oklab,var(--status,var(--ink))_12%,transparent)]",
  "focus-visible:bg-[color-mix(in_oklab,var(--status,var(--ink))_12%,transparent)] focus-visible:outline-hidden",
  "data-highlighted:bg-[color-mix(in_oklab,var(--status,var(--ink))_12%,transparent)]",
  "before:absolute before:inset-y-0 before:start-0 before:w-[0.1875rem] before:bg-[var(--status,var(--ink-soft))]",
  "before:motion-settle",
  "hover:before:w-[0.3125rem] focus-visible:before:w-[0.3125rem] data-highlighted:before:w-[0.3125rem]",
  "data-[current=true]:before:w-[0.3125rem]",
  "[&>span:first-of-type>span:first-child]:flex [&>span:first-of-type>span:first-child]:items-center [&>span:first-of-type>span:first-child]:justify-between [&>span:first-of-type>span:first-child]:gap-3",
  "[&>span:first-of-type>span:nth-child(2)]:whitespace-normal"
);

/**
 * Rows are ordered by pipeline position, so a menu always reads bottom-of-the
 * -pipeline to top no matter what order the statuses arrived in.
 */
export const byPipelinePosition = (
  a: StatusDisplayType,
  b: StatusDisplayType
) => a.percentage - b.percentage;

const statusVars = (status: StatusDisplayType): CSSProperties =>
  ({
    "--status": status.colourHex,
    "--pct": String(Math.max(0, Math.min(100, Math.round(status.percentage)))),
  }) as CSSProperties;

/**
 * The inside of one status row: the name across the body and the pipeline
 * percentage trailing. The colour rail is drawn by `.status-menu__item`, so
 * each host wraps this in its own menu-item primitive carrying that class.
 */
const StatusMenuRow = ({ status }: { status: StatusDisplayType }) => (
  <>
    <span className="min-w-0 truncate">{status.name}</span>
    <span className="shrink-0 text-micro text-ink-soft tabular-nums">
      {status.percentage}%
    </span>
  </>
);

type StatusNoteProps = {
  status: StatusDisplayType | null;
  /** The menu the panel sits beside; supplies the rect it is placed against. */
  anchor: HTMLElement | null;
  className?: string;
};

/**
 * The panel beside the menu describing whichever status is under the cursor.
 * Renders nothing until a row is hovered. A thin wrapper around `FloatingNote`
 * that supplies the status's own content and colour variables.
 */
const StatusNote = ({ status, anchor, className }: StatusNoteProps) => {
  const description = status?.description?.trim();

  return (
    <AnimatePresence>
      {status && (
        <FloatingNote
          key="status-note"
          anchor={anchor}
          placement="beside"
          className={cn("w-60 p-3.5 px-4", className)}
        >
          <div style={statusVars(status)}>
            {/* Mixed towards ink so a status near the paper colour stays readable. */}
            <p
              className="mb-2 text-body/[1.2]"
              style={{
                color:
                  "color-mix(in oklab, var(--status, var(--ink)) 70%, var(--ink))",
              }}
            >
              {status.name}
            </p>
            <p className="text-small/[1.5] text-pretty text-ink-soft">
              {description || "No description set."}
            </p>
            {/* The meter fills in the status' own colour rather than the artwork
                accent, since it is measuring that status' position. */}
            <div className="mt-3 flex items-center gap-2">
              <Meter
                value={status.percentage}
                fill="var(--status, var(--ink-soft))"
              />
              <span className="shrink-0 text-micro text-ink-soft tabular-nums">
                {status.percentage}%
              </span>
            </div>
          </div>
        </FloatingNote>
      )}
    </AnimatePresence>
  );
};

/**
 * Tracks which status the pointer is over and holds the menu element the note
 * panel is placed against. `menuProps` goes on the element wrapping the rows,
 * `rowHandlers` on each row.
 */
const useHoveredStatus = () => {
  const [hovered, setHovered] = useState<StatusDisplayType | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const clearHovered = () => setHovered(null);

  return {
    hovered,
    anchor,
    menuProps: {
      ref: setAnchor,
      onPointerLeave: clearHovered,
      onBlur: clearHovered,
    },
    rowHandlers: (status: StatusDisplayType) => ({
      onPointerEnter: () => setHovered(status),
      onFocus: () => setHovered(status),
    }),
    clearHovered,
  };
};

/**
 * The whole picker: one row per status in pipeline order, plus the note panel
 * for whichever row the pointer is over. Every menu that offers a status —
 * the rail dropdown, the table cell — is this list behind its own trigger.
 */
export const StatusMenuList = ({
  statuses,
  currentId,
  onPick,
}: {
  statuses: StatusDisplayType[];
  /** The status the entity is already in, drawn with a widened rail. */
  currentId?: number | null;
  onPick?: (status: StatusDisplayType) => void;
}) => {
  const isMobile = useIsMobile();
  const { hovered, anchor, menuProps, rowHandlers } = useHoveredStatus();
  const ordered = useMemo(
    () => [...statuses].sort(byPipelinePosition),
    [statuses]
  );

  return (
    <>
      <ResponsivePickerList className={statusMenu} {...menuProps}>
        {ordered.map((status) => {
          const desc = status.description?.trim();
          return (
            <ResponsivePickerItem
              key={status.id}
              selected={status.id === currentId}
              className={statusMenuItem}
              style={statusVars(status)}
              data-current={status.id === currentId}
              title={desc || undefined}
              description={isMobile && desc ? desc : undefined}
              onSelect={onPick ? () => onPick(status) : undefined}
              {...rowHandlers(status)}
            >
              <StatusMenuRow status={status} />
            </ResponsivePickerItem>
          );
        })}
      </ResponsivePickerList>
      {!isMobile && <StatusNote status={hovered} anchor={anchor} />}
    </>
  );
};
