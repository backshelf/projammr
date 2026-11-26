"use client";

import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import { cn } from "@workspace/ui/lib/utils";
import { SHEET_ROW, SheetCancelRow } from "@/components/dock/BottomSheet";
import { createContext, useCallback, use, useRef, type ReactNode } from "react";

import { usePlayback } from "@/components/music-player/use-playback";
import type { RowCardPlay } from "./row-card-model";

import {
  ActionItems,
  type ActionPrimitives,
  type RowActionsConfig,
  type RowActionsTarget,
} from "../RowActions";

/**
 * Closes the sheet and runs the chosen action once it has gone. An action that
 * opens a dialog of its own — the delete confirmation — would otherwise hand
 * one modal layer to another inside a single commit, and the two fight over
 * the body's pointer events.
 */
const RunOnCloseContext = createContext<(action: () => void) => void>(() => {});

const ITEM = cn(
  SHEET_ROW,
  "[&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:text-ink-soft"
);

function SheetActionItem({
  onSelect,
  variant,
  className,
  children,
}: {
  onSelect?: (event: Event) => void;
  variant?: "destructive";
  className?: string;
  children?: ReactNode;
}) {
  const runOnClose = use(RunOnCloseContext);
  return (
    <button
      type="button"
      className={cn(
        ITEM,
        variant === "destructive" &&
          "text-destructive [&_svg]:text-destructive",
        className
      )}
      onClick={() => runOnClose(() => onSelect?.(new Event("select")))}
    >
      {children}
    </button>
  );
}

function SheetSeparator({ className }: { className?: string }) {
  return <hr className={cn("my-1 border-rule", className)} />;
}

/** Playback as a row of the sheet, for the rows whose thumb also plays them. */
function SheetPlayItem({ play }: { play: RowCardPlay }) {
  const { showPause: playing, loading: resolving, toggle } = usePlayback(play);
  return (
    <SheetActionItem
      onSelect={() => void toggle()}
      className={resolving ? "opacity-50" : undefined}
    >
      <PlayGlyph playing={playing} />
      {playing ? "Pause" : "Play"}
    </SheetActionItem>
  );
}

/**
 * A sub-menu becomes an inline disclosure: its options open beneath the
 * trigger, indented, because a nested floating menu has nowhere to go on a
 * phone. Exported for any other phone surface that nests a sub-menu inside a
 * disclosure rather than a floating menu (the bulk bar's Labels menu).
 */
export const sheetPrimitives: ActionPrimitives = {
  Item: SheetActionItem,
  Separator: SheetSeparator,
  Sub: ({ children }) => <Collapsible>{children}</Collapsible>,
  SubTrigger: ({ className, children }) => (
    <CollapsibleTrigger className={cn(ITEM, className)}>
      {children}
      <CollapsibleChevron className="ml-auto" />
    </CollapsibleTrigger>
  ),
  SubContent: ({ className, children }) => (
    <CollapsibleContent className={cn("pl-8", className)}>
      {children}
    </CollapsibleContent>
  ),
};

export type RowActionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being acted on, named in the sheet's header. */
  title: string;
  subtitle?: string;
  config: RowActionsConfig;
  target: RowActionsTarget;
  /** Playback for the row, when it has any. */
  play?: RowCardPlay;
};

/**
 * The row menu as a bottom sheet — what a long press or the card's `⋯` opens.
 * It carries the same actions as the desktop right-click menu, so a row can do
 * exactly as much on a phone as it can with a mouse.
 */
export function RowActionSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  config,
  target,
  play,
}: RowActionSheetProps) {
  const chosenRef = useRef<(() => void) | null>(null);

  const runOnClose = useCallback(
    (action: () => void) => {
      chosenRef.current = action;
      onOpenChange(false);
    },
    [onOpenChange]
  );

  const runChosen = useCallback(() => {
    const action = chosenRef.current;
    chosenRef.current = null;
    action?.();
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 rounded-t-lg p-0"
        onClosed={runChosen}
      >
        <SheetHeader className="border-b border-rule px-4 py-3 pr-12">
          <SheetTitle className="truncate text-small">{title}</SheetTitle>
          {subtitle ? (
            <SheetDescription className="truncate">{subtitle}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="overflow-y-auto overscroll-contain py-1">
          <RunOnCloseContext value={runOnClose}>
            {play ? (
              <>
                <SheetPlayItem play={play} />
                <SheetSeparator />
              </>
            ) : null}
            <ActionItems
              config={config}
              target={target}
              primitives={sheetPrimitives}
            />
          </RunOnCloseContext>
        </div>
        <SheetCancelRow />
      </SheetContent>
    </Sheet>
  );
}
