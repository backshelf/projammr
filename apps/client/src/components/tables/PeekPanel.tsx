"use client";

import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import { AppLink } from "@/components/navigation/AppLink";
import { StatusChip } from "@workspace/ui/components/status-chip";
import {
  StatusDisplay,
  type StatusDisplayType,
} from "@/components/status/StatusDisplay";
import { PEEK_SCOPE } from "@/components/commands/peek";
import { useCommandScope } from "@/components/commands/provider";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { imageUrl } from "@/lib/utils";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { ResponsivePicker } from "@workspace/ui/components/responsive-picker";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { AnimatePresence, FADE, LEAVE, m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { PriorityLevel, Status } from "@workspace/api/api";
import * as React from "react";

import { PeekTitleEditor } from "./PeekTitleEditor";
import { PriorityBadge } from "./Priority";

/** One cell of the metadata grid. A `null`/empty value renders as "Not set". */
export type PeekField = {
  /** Stable identity: the React key, and what a card's `keyFields` names. */
  id: string;
  label: string;
  value: React.ReactNode;
  /** Columns spanned in the 3-column grid. */
  span?: 1 | 2 | 3;
  /** Renders the value in the mono face — for codes and identifiers. */
  mono?: boolean;
};

/** A named list of related records, shown as pills under the metadata grid. */
type PeekRelated = {
  label: string;
  items: { id: number; label: string }[];
};

/**
 * What the panel renders for one row. Every field comes from data the table
 * row already holds, so opening the panel costs no request — anything needing
 * a fetch (comments, activity, audio) lives on the full page instead.
 */
export type PeekRow = {
  id: number;
  title: string;
  /** Position in the collection being viewed, when collection-scoped. */
  trackNumber?: number | null;
  /** Secondary line under the title: artists, a track count, a date. */
  subtitle?: string;
  image?: string | null;
  /** A mark beside the title for a boolean the row wears, such as "Main". */
  flag?: string;
  priority?: PriorityLevel;
  status?: StatusDisplayType | null;
  fields?: PeekField[];
  related?: PeekRelated[];
};

/** One label/value pair in the metadata grid — the rail's pair at panel scale. */
function Field({
  label,
  children,
  className,
}: React.PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <div className={cn("min-w-0", className)}>
      <RailLabel>{label}</RailLabel>
      <MetadataItem>{children}</MetadataItem>
    </div>
  );
}

/**
 * The masthead's treatment at panel scale, so a row arrives carrying its own
 * artwork rather than on flat grey: a shorter field, a gentler blur, and a
 * scrim that reaches solid paper well before the metadata grid so the labels
 * never sit on colour.
 */
const PEEK_ART = cn(
  "pointer-events-none absolute inset-x-0 top-0 z-0 h-42 origin-top scale-125",
  "bg-[image:var(--art-image,none)] bg-cover bg-center blur-[40px] saturate-[1.6]",
  "opacity-95 dark:opacity-70",
  "[mask-image:linear-gradient(to_bottom,#000_0%,#000_30%,transparent_100%)]"
);

/** Transparent where the artwork is strongest, ramping to solid paper by the
 *  bottom so the metadata below starts on clean ground. Dark paper gives the
 *  header text its own contrast, so the scrim there can thin out. */
const PEEK_SCRIM = cn(
  "pointer-events-none absolute inset-x-0 top-0 z-0 h-42",
  "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--paper)_55%,transparent)_0%,color-mix(in_oklab,var(--paper)_48%,transparent)_45%,var(--paper)_100%)]",
  "dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--paper)_25%,transparent)_0%,color-mix(in_oklab,var(--paper)_20%,transparent)_45%,var(--paper)_100%)]"
);

function Section({
  label,
  count,
  children,
}: React.PropsWithChildren<{ label: string; count?: number }>) {
  return (
    <section className="relative border-t border-rule px-6 py-5">
      <SectionHead count={count}>{label}</SectionHead>
      {children}
    </section>
  );
}

export type PeekPanelProps = {
  row: PeekRow | null;
  /** Closes the panel — clears the peek param. */
  onClose: () => void;
  /** Full-page route for the open row. */
  href: string;
  /** Moves to the previous/next row of the current page; null when at an end. */
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
  /** Whether `onNext` is loading the next page before it can step. */
  nextLoading?: boolean;
  /** 1-based position of the open row within the loaded page. */
  position?: { index: number; total: number };
  /** Singular noun for the panel's description ("track", "collection"). */
  entityLabel?: string;
  /**
   * Swaps the title for an editor while `active`. The caller owns the state and
   * the write: `onSave` resolves whether the title was saved, and `onEnd` is
   * called when the editor is finished, including when the peeked row changes.
   */
  rename?: {
    active: boolean;
    onSave: (title: string) => Promise<boolean>;
    onEnd: () => void;
  };
  /** Playback target for track or collection peek panels. */
  play?: {
    kind: "track" | "collection";
    id: number;
    title?: string;
  } | null;
  /** Inline status picker configuration when the viewer can edit this row. */
  statusEdit?: {
    statuses: Status[];
    onSelect: (statusId: number) => Promise<boolean>;
  };
};

/**
 * Row detail shown beside the table rather than on its own page, so the grid
 * keeps its scroll position, filters and page while a row is inspected.
 *
 * The overlay is deliberately near-transparent and the panel is not modal:
 * the table stays readable underneath, which is the whole reason to peek
 * instead of navigating.
 */
export function PeekPanel({
  row,
  onClose,
  href,
  onPrevious,
  onNext,
  nextLoading = false,
  position,
  entityLabel = "record",
  rename,
  play,
  statusEdit,
}: PeekPanelProps) {
  // Left/right step through rows while the panel is open. Pushed innermost
  // over the table's own scope and the global player seek arrows, so the
  // panel's step wins the same keys for as long as it shows a row. Escape is
  // Base UI's: the drawer's dismiss hook listens for keydown on `document` in
  // the bubble phase, so anything inside the React tree that calls
  // `stopPropagation` on Escape keeps the sheet open. `PeekTitleEditor` relies
  // on that.
  const surface = React.useMemo(
    () => ({
      previous: onPrevious ?? undefined,
      next: onNext ?? undefined,
      nextLoading,
    }),
    [onPrevious, onNext, nextLoading]
  );
  useCommandScope(PEEK_SCOPE, surface, Boolean(row));

  // A rename belongs to the row it began on: stepping to another row ends it.
  // Latched when `active` turns on, so a rename that opens together with a new
  // row is not mistaken for that row changing under it.
  const renameEndRef = useLatestRef(rename?.onEnd);
  const renameActive = rename?.active ?? false;
  const rowId = row?.id ?? null;
  const renamingRowIdRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!renameActive) {
      renamingRowIdRef.current = null;
    } else if (renamingRowIdRef.current === null) {
      renamingRowIdRef.current = rowId;
    } else if (renamingRowIdRef.current !== rowId) {
      renameEndRef.current?.();
    }
  }, [renameActive, rowId, renameEndRef]);

  const cover = imageUrl(row?.image, 256);

  return (
    <Sheet open={row != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // Wider than the sheet default: a metadata grid needs the room, and the
        // table is still legible beside it.
        className="w-full gap-0 overflow-y-auto bg-paper p-0 sm:max-w-[27rem]"
        // Near-transparent, unblurred: the grid stays readable beside the panel.
        overlayClassName="bg-ink/10 supports-backdrop-filter:backdrop-blur-none"
        // A press on the table beside the panel leaves the panel open.
        dismissOnOutside={false}
        // The table's keys (`j`/`k` moving the peeked row) stay live beside it.
        modalScope={false}
        // The subtitle is the description when there is one; a row without one
        // (no artists, no DAW) is described well enough by its title alone.
        aria-describedby={row?.subtitle ? undefined : ""}
      >
        {row && (
          <>
            {/* The masthead's field, at panel scale: the cover blurred past
                recognition and faded out before the metadata starts, so the
                row arrives with its own colour rather than on grey. */}
            <div
              className={PEEK_ART}
              aria-hidden
              style={
                cover
                  ? ({
                      "--art-image": `url("${cover}")`,
                    } as React.CSSProperties)
                  : undefined
              }
            />
            <div className={PEEK_SCRIM} aria-hidden />

            <div className="relative flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onPrevious?.()}
                  disabled={!onPrevious}
                  aria-label={`Previous ${entityLabel}`}
                >
                  <IconChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onNext?.()}
                  disabled={!onNext || nextLoading}
                  aria-label={`Next ${entityLabel}`}
                >
                  {nextLoading ? <Spinner /> : <IconChevronRight />}
                </Button>
                {position && (
                  <span className="ml-1 font-mono text-micro text-ink-soft tabular-nums">
                    {position.index} / {position.total}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <AppLink href={href}>Open full page</AppLink>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  aria-label="Close panel"
                >
                  <IconX />
                </Button>
              </div>
            </div>

            {/* Prev/next hold the panel still and change what is in it, so
                the body crosses over: one row's detail leaves before the
                next arrives, and the chrome above never blinks. */}
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={row.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: FADE.quick }}
                exit={{ opacity: 0, transition: LEAVE.quick }}
              >
                <header className="relative flex gap-4 px-6 pt-3 pb-6">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt=""
                      className="size-16 shrink-0 rounded-md border border-rule object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {play && (
                        <PlayAffordance
                          kind={play.kind}
                          id={play.id}
                          title={play.title}
                          hideMenu
                        />
                      )}
                      {/* The dialog's accessible name stays mounted while the
                          editor is up, so it never loses its label. */}
                      <SheetTitle
                        className={cn(
                          "truncate text-lead leading-tight font-medium",
                          rename?.active && "sr-only"
                        )}
                      >
                        {row.title}
                      </SheetTitle>
                      {rename?.active && (
                        <PeekTitleEditor
                          title={row.title}
                          onSave={rename.onSave}
                          onEnd={rename.onEnd}
                        />
                      )}
                      {row.flag && (
                        <StatusChip
                          flag
                          colour="var(--ink-soft)"
                          className="flex-none"
                        >
                          {row.flag}
                        </StatusChip>
                      )}
                    </div>
                    {row.subtitle && (
                      <SheetDescription className="mt-1 truncate">
                        {row.subtitle}
                      </SheetDescription>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {statusEdit && statusEdit.statuses.length > 0 ? (
                        <ResponsivePicker
                          value={
                            row.status?.id != null
                              ? String(row.status.id)
                              : undefined
                          }
                          onSelect={(next) =>
                            void statusEdit.onSelect(Number(next))
                          }
                          options={statusEdit.statuses.map((s) => ({
                            value: String(s.id),
                            label: s.name,
                            icon: (
                              <span
                                aria-hidden
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: s.colourHex }}
                              />
                            ),
                          }))}
                          searchable={false}
                          title="Status"
                          align="start"
                          trigger={
                            <button
                              type="button"
                              aria-label="Change status"
                              className="inline-flex items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring coarse:min-h-11"
                            >
                              {row.status ? (
                                <StatusDisplay
                                  status={row.status}
                                  variant="chip"
                                />
                              ) : (
                                <StatusChip colour="var(--ink-soft)">
                                  Set status
                                </StatusChip>
                              )}
                            </button>
                          }
                        />
                      ) : (
                        row.status && (
                          <StatusDisplay status={row.status} variant="chip" />
                        )
                      )}
                      {row.priority && (
                        <PriorityBadge level={row.priority} hideDefault />
                      )}
                    </div>
                  </div>
                </header>

                {row.fields && row.fields.length > 0 && (
                  <div className="relative grid grid-cols-3 gap-x-4 gap-y-5 border-t border-rule px-6 py-5">
                    {row.fields.map((field) => (
                      <Field
                        key={field.id}
                        label={field.label}
                        className={
                          field.span === 3
                            ? "col-span-3"
                            : field.span === 2
                              ? "col-span-2"
                              : undefined
                        }
                      >
                        {field.mono && field.value ? (
                          <span className="font-mono">{field.value}</span>
                        ) : (
                          field.value
                        )}
                      </Field>
                    ))}
                  </div>
                )}

                {row.related?.map(
                  (group) =>
                    group.items.length > 0 && (
                      <Section
                        key={group.label}
                        label={group.label}
                        count={group.items.length}
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {group.items.slice(0, 12).map((item) => (
                            <StatusChip
                              key={item.id}
                              flag
                              colour={"var(--ink-soft)"}
                            >
                              {item.label}
                            </StatusChip>
                          ))}
                          {group.items.length > 12 && (
                            <StatusChip
                              flag
                              colour={"var(--ink-soft)"}
                              className={"text-ink-soft"}
                            >
                              {group.items.length - 12} more
                            </StatusChip>
                          )}
                        </div>
                      </Section>
                    )
                )}
              </m.div>
            </AnimatePresence>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
