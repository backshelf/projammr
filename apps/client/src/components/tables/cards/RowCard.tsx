"use client";

import { AppLink } from "@/components/navigation/AppLink";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { IconDotsVertical, IconGripVertical } from "@tabler/icons-react";
import { CollapsibleChevron } from "@workspace/ui/components/collapsible";
import { IconButton } from "@workspace/ui/components/icon-button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { TrackCell } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import {
  memo,
  useCallback,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

import { isSuppressedPriority, PriorityBadge } from "../Priority";
import { StatusDisplay } from "@/components/status/StatusDisplay";
import { imageUrl } from "@/lib/utils";
import { CardPlayButton } from "./CardPlay";
import { useLongPress } from "@/hooks/use-long-press";
import type { RowCardChild, RowCardModel } from "./row-card-model";

/** The subtitle and key fields as one full-width, single-line run of text. */
function MetaText({ row }: { row: RowCardModel }) {
  // Keyed by what each part is: the subtitle, or a field by its label.
  const parts: { key: string; value: ReactNode }[] = [];
  if (row.subtitle) parts.push({ key: "subtitle", value: row.subtitle });
  for (const field of row.fields)
    parts.push({ key: `field:${field.id}`, value: field.value });
  if (parts.length === 0) return null;

  return (
    <div className="mt-0.5 min-w-0 truncate text-small text-ink-soft">
      {parts.map((part, index) => (
        <span key={part.key}>
          {index > 0 ? <span className="px-1 text-ink-faint">·</span> : null}
          {part.value}
        </span>
      ))}
    </div>
  );
}

/**
 * Compact status and priority pills on their own row beneath the subtitle and
 * fields, so metadata text keeps the full card width and cards hold a uniform
 * rhythm on narrow screens.
 */
function ChipRow({ row }: { row: RowCardModel }) {
  const showPriority = Boolean(
    row.priority && !isSuppressedPriority(row.priority)
  );
  if (!row.status && !showPriority) return null;

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      {row.status ? (
        <StatusDisplay
          status={row.status}
          variant="chip"
          className="max-w-36 min-w-0 truncate"
        />
      ) : null}
      {showPriority && row.priority ? (
        <PriorityBadge level={row.priority} hideDefault />
      ) : null}
    </div>
  );
}

/** Title, metadata text, and status/priority chips — everything a tap on the row acts on. */
function Identity({ row }: { row: RowCardModel }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        {row.trackNumber != null ? (
          <span className="shrink-0 font-mono text-micro text-ink-soft tabular-nums">
            #{row.trackNumber}
          </span>
        ) : null}
        <span className="truncate text-body font-medium text-ink">
          {row.title}
        </span>
        {row.flag ? (
          <StatusChip flag colour="var(--ink-soft)" className="flex-none">
            {row.flag}
          </StatusChip>
        ) : null}
      </div>
      <MetaText row={row} />
      <ChipRow row={row} />
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
  cardRef,
  style,
  isDragging,
  dragHandle,
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
  cardRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  isDragging?: boolean;
  dragHandle?: {
    attributes: DraggableAttributes;
    listeners: SyntheticListenerMap | undefined;
  };
}) {
  const openActions = useCallback(
    () => onOpenActions?.(row.id),
    [onOpenActions, row.id]
  );
  const { handlers: longPress, pressing } = useLongPress(openActions);
  const thumb = imageUrl(row.image, 256);
  const children = row.children ?? [];
  const canExpand =
    !dragHandle && onToggleExpand != null && children.length > 0;
  // A row with no artwork and nothing to put on it — a session, say — would
  // lead with an empty tile, so the identity takes the head of the card
  // instead. The checkbox needs the tile back while the list is selecting.
  const showThumb = onToggleSelect != null || !!thumb || row.play != null;

  return (
    <div
      ref={cardRef}
      style={style}
      role="listitem"
      className={cn(
        "border-b border-rule bg-paper",
        "select-none [-webkit-touch-callout:none]",
        "[contain-intrinsic-size:auto_76px] [content-visibility:auto]",
        isDragging && "opacity-40"
      )}
    >
      <div
        // The card settles under a finger that is holding it, so the wait for
        // the action sheet is visible rather than a silent 450 ms.
        data-pressing={pressing || undefined}
        className="flex min-h-14 items-center gap-3 px-(--gutter) py-2.5 motion-settle data-pressing:scale-[0.985]"
        {...(onOpenActions && !dragHandle ? longPress : {})}
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
        {dragHandle ? (
          <button
            type="button"
            aria-label={`Drag to reorder ${row.title}`}
            style={{ touchAction: "none" }}
            className="inline-flex size-11 shrink-0 cursor-grab items-center justify-center rounded-md text-ink-soft active:cursor-grabbing"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <IconGripVertical className="size-5" aria-hidden />
          </button>
        ) : onOpenActions ? (
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
