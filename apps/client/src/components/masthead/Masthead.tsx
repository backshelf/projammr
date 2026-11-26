"use client";

import { MastheadMorph } from "@/components/motion/ArtMorph";
import { useMastheadScroll } from "@/components/motion/masthead-scroll";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { COLUMN, EYEBROW } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { PropsWithChildren, ReactNode } from "react";

/** The heading's class string, shared with the inline title editor so an
 *  editable title is set exactly like a fixed one. */
export const mastheadTitle = (compact: boolean) =>
  cn(
    "mb-2 font-heading tracking-[-0.015em] [overflow-wrap:anywhere]",
    compact
      ? "max-w-[24ch] text-title/[0.94]"
      : "max-w-[18ch] text-display/[0.94] phone:text-title"
  );

/**
 * The one loud element of every entity page: an oversized blurred-artwork
 * field behind a breadcrumb, an eyebrow, the title and a byline, with a slot
 * for the player row.
 *
 * The blurred-artwork field and its legibility scrim are rendered one level up
 * by `ArtProvider`, as siblings of the scroll container's content rather than
 * children of this header: a blurred, scaled layer trapped in the masthead's
 * own stacking context would bleed over the page body below it. They read
 * `--art-image` and the accent channel from that same wrapper; when no artwork
 * resolves anywhere in the hierarchy `--art-image` is `none` and only the
 * grayscale scrim shows. The art's mask fades it to zero well above the field's
 * bottom so it dissolves into the page rather than cutting on a line.
 *
 * {@link MastheadMorph} puts the header in its own view-transition group so it
 * stays above the art while the art morphs, and slides it on a running-order
 * step. The header element belongs to that group, so it carries no Motion of
 * its own: the column inside it is what lifts away as the canvas scrolls.
 *
 * A `title` given as an element rather than a string carries its own arrival —
 * `InlineTitleEditor` is the one that does — because the editor owns the root
 * the heading swaps under.
 */
export function Masthead({
  crumbs,
  eyebrow,
  title,
  byline,
  compact = false,
  className,
  children,
}: PropsWithChildren<{
  className?: string;
  crumbs?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  byline?: ReactNode;
  /** Render the title at the compact size — used where titles run long. */
  compact?: boolean;
}>) {
  const eyebrowArrival = useArrival("eyebrow");
  const titleArrival = useArrival("title");
  const bylineArrival = useArrival("byline");
  const headScroll = useMastheadScroll("head");

  return (
    <MastheadMorph>
      <header
        className={cn(
          // `masthead` scopes the status pie fill in globals.css to this
          // header. Its floor is `--masthead-head`, which the phone tier and
          // `data-masthead` step.
          "masthead relative flex min-h-(--masthead-head) flex-col p-(--gutter) pb-7",
          "phone:pt-4",
          className
        )}
      >
        {crumbs && <div className={COLUMN}>{crumbs}</div>}

        <m.div style={headScroll} className={cn("mt-auto", COLUMN)}>
          {eyebrow && (
            <m.div {...eyebrowArrival} className={EYEBROW}>
              {eyebrow}
            </m.div>
          )}
          {typeof title === "string" ? (
            <m.h1 {...titleArrival} className={mastheadTitle(compact)}>
              {title}
            </m.h1>
          ) : (
            title
          )}
          {byline && (
            <m.div
              {...bylineArrival}
              className={
                "flex flex-wrap items-center gap-3 text-body text-ink-soft"
              }
            >
              {byline}
            </m.div>
          )}
          {children}
        </m.div>
      </header>
    </MastheadMorph>
  );
}
