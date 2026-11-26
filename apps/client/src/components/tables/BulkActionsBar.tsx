"use client";

import { IconX } from "@tabler/icons-react";
import type { Label, PriorityLevel, Status } from "@workspace/api/api";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { FADE, LEAVE, m, SPRING } from "@workspace/ui/lib/motion";
import { useState } from "react";

import type { FieldValue } from "@/fields/types";
import type { CustomField } from "@workspace/api/api";

import { sheetPrimitives } from "./cards/RowActionSheet";
import { PriorityBadge } from "./Priority";
import { SetFieldPopover } from "./SetFieldPopover";
import type { ActionPrimitives, DeclaredActionItem } from "./RowActions";
import { StatusOption } from "./RowActions";

/** A label as a menu option: a colour dot beside its name, the same pairing
 *  the labels cell's own picker uses. */
function LabelOption({ label }: { label: Label }) {
  return (
    <>
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: label.colourHex }}
      />
      <span className="truncate">{label.name}</span>
    </>
  );
}

/**
 * The Labels menu's body: "Add label…" and "Remove label…", each a sub-menu
 * listing every project label. The same list either way — a bulk target
 * carries no per-row label state to tick against — so adding and removing
 * are two mirrored lists rather than one with a mixed state.
 *
 * Generic over `ActionPrimitives` so the desktop dropdown and the phone
 * disclosure host the identical list; only the primitives differ.
 */
function LabelSubmenus({
  labels,
  onPick,
  primitives,
}: {
  labels: Label[];
  onPick: (add: number[], remove: number[]) => void;
  primitives: Pick<
    ActionPrimitives,
    "Item" | "Sub" | "SubTrigger" | "SubContent"
  >;
}) {
  const { Item, Sub, SubTrigger, SubContent } = primitives;
  return (
    <>
      <Sub>
        <SubTrigger>Add label…</SubTrigger>
        <SubContent className="max-h-72 overflow-y-auto">
          {labels.map((label) => (
            <Item key={label.id} onSelect={() => onPick([label.id], [])}>
              <LabelOption label={label} />
            </Item>
          ))}
        </SubContent>
      </Sub>
      <Sub>
        <SubTrigger>Remove label…</SubTrigger>
        <SubContent className="max-h-72 overflow-y-auto">
          {labels.map((label) => (
            <Item key={label.id} onSelect={() => onPick([], [label.id])}>
              <LabelOption label={label} />
            </Item>
          ))}
        </SubContent>
      </Sub>
    </>
  );
}

/**
 * Floating bar shown while rows are selected. Renders only the actions whose
 * handler was supplied. "Set status", "Add to collection", "Labels" and
 * "Priority" open a small dropdown of options; "Delete" hands off to the
 * table's confirmation; "Move" opens the move dialog. The table kind's
 * declared `actions` sit just before "Move", one button each. When the current
 * page's rows are all selected and the filter matches more, the bar offers
 * escalating to "all N matching" — in that mode only "Add to collection"
 * drops out, because it takes explicit row ids rather than a selection the
 * server can resolve from the filter alone.
 *
 * The bar wraps within the viewport rather than growing past it: centred, an
 * over-wide child overflows both edges at once and the left half of it is
 * unreachable. On a phone it also sits above whatever is docked to the bottom
 * edge (`--dock`), which is zero at every width that has no dock. The Labels
 * menu nests a sub-menu per side (add / remove); on a phone that nesting is a
 * disclosure inline in the bar rather than a floating flyout, reusing the
 * same primitives the row action sheet turns its own sub-menus into.
 *
 * `statuses` arrives already in pipeline order.
 */
export function BulkActionsBar({
  selectedCount,
  entityLabel,
  allMatching,
  canSelectAllMatching,
  onSelectAllMatching,
  onClear,
  statuses,
  collections,
  labels,
  priorityLevels,
  fields,
  onSetStatus,
  onAddToCollection,
  onSetLabels,
  onSetPriority,
  onSetField,
  actions,
  onMove,
  onDelete,
}: {
  selectedCount: number;
  entityLabel: string;
  allMatching: boolean;
  canSelectAllMatching: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
  statuses?: Status[];
  collections?: { id: number; title: string }[];
  labels?: Label[];
  /** The project's priority scale, bottom level first. */
  priorityLevels?: PriorityLevel[];
  onSetStatus?: (statusId: number) => void | Promise<void>;
  onAddToCollection?: (collectionId: number) => void | Promise<void>;
  onSetLabels?: (add: number[], remove: number[]) => void | Promise<void>;
  onSetPriority?: (priorityId: number) => void | Promise<void>;
  /** The project's custom fields, offered by "Set field…". */
  fields?: readonly CustomField[];
  onSetField?: (key: string, value: FieldValue) => void | Promise<void>;
  actions?: DeclaredActionItem[];
  onMove?: () => void;
  onDelete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isMobile = useIsMobile();
  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    // The bar rises from the bottom edge as a surface taking its place, and
    // leaves the way it came, a little faster and a little shorter.
    <m.div
      initial={{ opacity: 0, y: 16 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { opacity: FADE.move, y: SPRING.surface },
      }}
      exit={{ opacity: 0, y: 8, transition: LEAVE.move }}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center phone:bottom-[calc(var(--dock)+0.75rem)]"
    >
      <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-lg border border-glass-edge bg-glass px-3 py-2 shadow-float backdrop-blur-[20px]">
        <span className="text-small font-medium phone:basis-full phone:text-center">
          {selectedCount} {entityLabel}
          {selectedCount === 1 ? "" : "s"} selected
        </span>

        {canSelectAllMatching && !allMatching && (
          <Button variant="link" size="sm" onClick={onSelectAllMatching}>
            Select all matching
          </Button>
        )}

        {onSetStatus && statuses && statuses.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                Set status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              className="max-h-72 overflow-y-auto"
            >
              {statuses.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => void run(() => onSetStatus(s.id))}
                >
                  <StatusOption status={s} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onAddToCollection && collections && collections.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                Add to collection
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              className="max-h-72 overflow-y-auto"
            >
              {collections.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => void run(() => onAddToCollection(c.id))}
                >
                  {c.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onSetLabels &&
          (isMobile ? (
            // `basis-full` on the whole disclosure, trigger included: the
            // Labels item can grow much taller than its siblings once open,
            // and a shared flex line centres shorter siblings against that
            // height (`items-center`) — its own line avoids that.
            <Collapsible className="basis-full">
              <CollapsibleTrigger
                disabled={busy || !labels || labels.length === 0}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "w-full justify-center",
                })}
              >
                {labels && labels.length > 0 ? "Labels" : "No labels yet"}
                {labels && labels.length > 0 && (
                  <CollapsibleChevron className="ml-1" />
                )}
              </CollapsibleTrigger>
              {labels && labels.length > 0 && (
                <CollapsibleContent>
                  <LabelSubmenus
                    labels={labels}
                    onPick={(add, remove) =>
                      void run(() => onSetLabels(add, remove))
                    }
                    primitives={sheetPrimitives}
                  />
                </CollapsibleContent>
              )}
            </Collapsible>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !labels || labels.length === 0}
                >
                  {labels && labels.length > 0 ? "Labels" : "No labels yet"}
                </Button>
              </DropdownMenuTrigger>
              {labels && labels.length > 0 && (
                <DropdownMenuContent align="center">
                  <LabelSubmenus
                    labels={labels}
                    onPick={(add, remove) =>
                      void run(() => onSetLabels(add, remove))
                    }
                    primitives={{
                      Item: DropdownMenuItem,
                      Sub: DropdownMenuSub,
                      SubTrigger: DropdownMenuSubTrigger,
                      SubContent: DropdownMenuSubContent,
                    }}
                  />
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          ))}

        {onSetPriority && priorityLevels && priorityLevels.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                Priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              className="max-h-72 overflow-y-auto"
            >
              {priorityLevels.map((level) => (
                <DropdownMenuItem
                  key={level.id}
                  onClick={() => void run(() => onSetPriority(level.id))}
                >
                  <PriorityBadge level={level} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onSetField && fields && fields.length > 0 && (
          <SetFieldPopover
            fields={fields}
            disabled={busy}
            onApply={(key, value) => run(() => onSetField(key, value))}
          />
        )}

        {actions?.map(({ id, label, onSelect }) => (
          <Button
            key={id}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(onSelect)}
          >
            {label}
          </Button>
        ))}

        {onMove && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onMove}>
            Move to project…
          </Button>
        )}

        {onDelete && (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="coarse:size-11"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <IconX size={16} />
        </Button>
      </div>
    </m.div>
  );
}
