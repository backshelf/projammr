"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { IconDotsVertical } from "@tabler/icons-react";
import { CollapsibleChevron } from "@workspace/ui/components/collapsible";
import { IconButton } from "@workspace/ui/components/icon-button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { TrackCell } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { memo, useCallback, type ReactNode } from "react";

import { PriorityBadge } from "../Priority";
import { StatusDisplay } from "@/components/status/StatusDisplay";
import { imageUrl } from "@/lib/utils";
import { CardPlayButton } from "./CardPlay";
import { useLongPress } from "@/hooks/use-long-press";
import type { RowCardChild, RowCardModel } from "./row-card-model";

/** The subtitle and key fields as one run of text. */
function MetaText({ row }: { row: RowCardModel }) {
  // Keyed by what each part is: the subtitle, or a field by its label.
  const parts: { key: string; value: ReactNode }[] = [];
  if (row.subtitle) parts.push({ key: "subtitle", value: row.subtitle });
  for (const field of row.fields)
    parts.push({ key: `field:${field.id}`, value: field.value });
  if (parts.length === 0) return null;

  return (
    <span className="min-w-0 flex-1 truncate text-small text-ink-soft phone:line-clamp-2 phone:whitespace-normal">
      {parts.map((part, index) => (
        <span key={part.key}>
          {index > 0 ? <span className="px-1 text-ink-faint">·</span> : null}
          {part.value}
        </span>
      ))}
    </span>
  );
}

/**
 * What the row is beyond its name: its status and priority, then the text the
 * card carries. All of it sits under the title rather than at the row's
 * trailing edge, where a chip and a badge would leave the title a sliver of
 * the width on a phone.
 */
function MetaLine({ row }: { row: RowCardModel }) {
  if (
    !row.status &&
    !row.priority &&
    !row.subtitle &&
    row.fields.length === 0
  ) {
    return null;
  }

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      {row.status ? (
        <StatusDisplay
          status={row.status}
          variant="chip"
          className="max-w-36 min-w-0 truncate"
        />
      ) : null}
      {row.priority ? <PriorityBadge level={row.priority} /> : null}
      <MetaText row={row} />
    </div>
  );
}

/** Title, its flag and the meta line — everything a tap on the row acts on. */
function Identity({ row }: { row: RowCardModel }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-body font-medium text-ink">
          {row.title}
        </span>
        {row.flag ? (
          <StatusChip flag colour="var(--ink-soft)" className="flex-none">
            {row.flag}
          </StatusChip>
        ) : null}
      </div>
      <MetaLine row={row} />
    </div>
  );
}

const CHILD_LINE =
  "flex min-h-11 items-center gap-2 py-1.5 pr-(--gutter) pl-14 text-small";

function ChildLine({ child }: { child: RowCardChild }) {
  const line = (
    <>
      <span className="truncate text-ink-soft">{child.title}</span>
      {child.subtitle ? (
        <span className="truncate text-ink-soft">{child.subtitle}</span>
      ) : null}
    </>
  );
  return child.href ? (
    <AppLink href={child.href} className={CHILD_LINE}>
      {line}
    </AppLink>
  ) : (
    <div className={CHILD_LINE}>{line}</div>
  );
}

/**
 * One row of a phone list: the artwork, the identity as a link to the row's
 * page, and the same actions the desktop row offers behind a long press or the
 * `⋯`. Status is the tinted chip in the meta line, the same treatment tables
 * use, so a list of rows reads as one table rather than a stack of cards.
 *
 * A row the player can take carries its play control on the artwork, so the
 * thumb plays and the text opens — the split the desktop row makes between its
 * play column and its title.
 *
 * `onToggleSelect` is given only while the list is selecting: the checkbox
 * takes the artwork's place as the thing the thumb does, and a tap on the
 * identity ticks the row instead of opening it, since the same tap cannot do
 * both.
 */
export const RowCard = memo(function RowCard({
  row,
  entityLabel,
  onOpenActions,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
}: {
  row: RowCardModel;
  entityLabel: string;
  /** Absent when the table offers no row actions. */
  onOpenActions?: (id: number) => void;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  expanded?: boolean;
  /** Absent when the table has no hierarchy to disclose. */
  onToggleExpand?: (id: number) => void;
}) {
  const openActions = useCallback(
    () => onOpenActions?.(row.id),
    [onOpenActions, row.id]
  );
  const { handlers: longPress, pressing } = useLongPress(openActions);
  const thumb = imageUrl(row.image, 256);
  const children = row.children ?? [];
  const canExpand = onToggleExpand != null && children.length > 0;
  // A row with no artwork and nothing to put on it — a session, say — would
  // lead with an empty tile, so the identity takes the head of the card
  // instead. The checkbox needs the tile back while the list is selecting.
  const showThumb = onToggleSelect != null || !!thumb || row.play != null;

  return (
    <div
      role="listitem"
      className={cn(
        "border-b border-rule",
        "select-none [-webkit-touch-callout:none]"
      )}
    >
      <div
        // The card settles under a finger that is holding it, so the wait for
        // the action sheet is visible rather than a silent 450 ms.
        data-pressing={pressing || undefined}
        className="flex min-h-14 items-center gap-3 px-(--gutter) py-2.5 motion-settle data-pressing:scale-[0.985]"
        {...(onOpenActions ? longPress : {})}
      >
        {showThumb ? (
          <TrackCell image={thumb} size="xl" className="relative size-11">
            {onToggleSelect ? (
              <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-sm bg-ink/40">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--art)]"
                  aria-label={`Select ${entityLabel} ${row.title}`}
                  checked={selected ?? false}
                  onChange={() => onToggleSelect(row.id)}
                />
              </label>
            ) : row.play ? (
              <CardPlayButton play={row.play} entityLabel={entityLabel} />
            ) : null}
          </TrackCell>
        ) : null}

        {onToggleSelect ? (
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onToggleSelect(row.id)}
          >
            <Identity row={row} />
          </button>
        ) : (
          <AppLink href={row.href} className="min-w-0 flex-1">
            <Identity row={row} />
          </AppLink>
        )}

        {canExpand ? (
          <IconButton
            size="touch"
            className="group/collapsible-trigger"
            aria-expanded={expanded ?? false}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${entityLabel} ${row.title}`}
            onClick={() => onToggleExpand(row.id)}
          >
            <CollapsibleChevron />
          </IconButton>
        ) : null}
        {onOpenActions ? (
          <IconButton
            size="touch"
            aria-label={`Actions for ${entityLabel} ${row.title}`}
            onClick={openActions}
          >
            <IconDotsVertical />
          </IconButton>
        ) : null}
      </div>

      {canExpand && expanded ? (
        <div className="border-t border-rule">
          {children.map((child) => (
            <ChildLine key={child.id} child={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
});
