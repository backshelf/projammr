"use client";

import {
  IconCheck,
  IconHash,
  IconTag,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Input } from "@workspace/ui/components/input";
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
import {
  createContext,
  useCallback,
  use,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  const [artistDraft, setArtistDraft] = useState("");
  const [trackNumDraft, setTrackNumDraft] = useState(
    config.reorder ? String(config.reorder.trackNumber) : "1"
  );
  const [prevKey, setPrevKey] = useState(
    `${open}:${title}:${config.reorder?.trackNumber ?? ""}`
  );
  const key = `${open}:${title}:${config.reorder?.trackNumber ?? ""}`;
  if (key !== prevKey) {
    setPrevKey(key);
    setArtistDraft("");
    setTrackNumDraft(config.reorder ? String(config.reorder.trackNumber) : "1");
  }

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
            {config.labels &&
              config.labels.length > 0 &&
              config.onSetLabels && (
                <Collapsible>
                  <CollapsibleTrigger className={ITEM}>
                    <IconTag />
                    <span>Labels</span>
                    <CollapsibleChevron className="ml-auto" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-8">
                    {config.labels.map((label) => {
                      const active =
                        config.rowLabelIds?.includes(label.id) ?? false;
                      return (
                        <button
                          key={label.id}
                          type="button"
                          className={cn(SHEET_ROW, "justify-between")}
                          onClick={() =>
                            config.onSetLabels?.(
                              active ? [] : [label.id],
                              active ? [label.id] : []
                            )
                          }
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              aria-hidden
                              className="size-3 shrink-0 rounded-full"
                              style={{ backgroundColor: label.colourHex }}
                            />
                            <span className="truncate">{label.name}</span>
                          </span>
                          {active && (
                            <IconCheck className="size-4 shrink-0 text-art" />
                          )}
                        </button>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              )}
            {config.artists && target.count === 1 && (
              <Collapsible>
                <CollapsibleTrigger className={ITEM}>
                  <IconUsers />
                  <span>Artists</span>
                  <CollapsibleChevron className="ml-auto" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 px-4 pt-1 pb-3">
                  {config.artists.current.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {config.artists.current.map((artist) => (
                        <span
                          key={artist}
                          className="inline-flex items-center gap-1 rounded-full border border-rule px-2.5 py-1 text-small text-ink"
                        >
                          <span>{artist}</span>
                          <button
                            type="button"
                            aria-label={`Remove artist ${artist}`}
                            className="text-ink-soft hover:text-ink"
                            onClick={() =>
                              void config.artists?.onSave(
                                config.artists.current.filter(
                                  (a) => a !== artist
                                )
                              )
                            }
                          >
                            <IconX className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const nextName = artistDraft.trim();
                      if (!nextName || !config.artists) return;
                      if (!config.artists.current.includes(nextName)) {
                        void config.artists.onSave([
                          ...config.artists.current,
                          nextName,
                        ]);
                      }
                      setArtistDraft("");
                    }}
                  >
                    <Input
                      value={artistDraft}
                      onChange={(e) => setArtistDraft(e.target.value)}
                      placeholder="Add artist"
                      aria-label="Add artist"
                      className="flex-1 coarse:h-11"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="coarse:min-h-11"
                    >
                      Add
                    </Button>
                  </form>
                  {config.artists.suggestions &&
                    config.artists.suggestions.filter(
                      (s) => !config.artists!.current.includes(s)
                    ).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {config.artists.suggestions
                          .filter((s) => !config.artists!.current.includes(s))
                          .slice(0, 8)
                          .map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              className="rounded-full border border-rule px-2.5 py-1 text-micro text-ink-soft hover:text-ink coarse:min-h-9"
                              onClick={() =>
                                void config.artists?.onSave([
                                  ...config.artists.current,
                                  suggestion,
                                ])
                              }
                            >
                              + {suggestion}
                            </button>
                          ))}
                      </div>
                    )}
                </CollapsibleContent>
              </Collapsible>
            )}
            {config.reorder && target.count === 1 && (
              <Collapsible>
                <CollapsibleTrigger className={ITEM}>
                  <IconHash />
                  <span>Set track #</span>
                  <CollapsibleChevron className="ml-auto" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pt-1 pb-3">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = Number(trackNumDraft);
                      if (!Number.isInteger(n) || n < 1 || !config.reorder)
                        return;
                      const setNum = config.reorder.onSetTrackNumber;
                      onOpenChange(false);
                      void setNum(n);
                    }}
                  >
                    <Input
                      type="number"
                      min={1}
                      max={config.reorder.total}
                      value={trackNumDraft}
                      onChange={(e) => setTrackNumDraft(e.target.value)}
                      aria-label="Track number"
                      className="flex-1 coarse:h-11"
                    />
                    <Button type="submit" size="sm" className="coarse:min-h-11">
                      Apply
                    </Button>
                  </form>
                </CollapsibleContent>
              </Collapsible>
            )}
          </RunOnCloseContext>
        </div>
        <SheetCancelRow />
      </SheetContent>
    </Sheet>
  );
}
