"use client";

import {
  ArrivalRoot,
  useArrival,
  useArrivalKind,
} from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { COLUMN } from "@workspace/ui/lib/shell";
import React from "react";

/**
 * The head of a page that has no entity behind it — the list pages, settings,
 * the profile. There is no artwork to carry these, so the title does it alone
 * at the compact display size, above an optional line saying what the page is
 * for.
 *
 * It is the arrival root of such a page: the title and the lede rise through
 * it on a first load and crossfade on a navigation.
 */
export const PageHead = ({
  crumbs,
  title,
  lede,
  action,
  size = "title",
}: {
  crumbs?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: React.ReactNode;
  /** Pages with nothing behind them — sign-in, connect — take the step down. */
  size?: "title" | "subtitle";
}) => (
  <ArrivalRoot
    as={"header"}
    kind={useArrivalKind()}
    className={cn("flex flex-col pt-(--gutter)", COLUMN)}
  >
    {crumbs}
    {/* On a phone the actions take the full width under the lede: sharing the
        row with a view switcher and a New button leaves the lede a column
        barely wide enough to wrap on. */}
    <div
      className={
        "flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4"
      }
    >
      <PageHeadTitle title={title} lede={lede} size={size} />
      {action && <div className={"shrink-0"}>{action}</div>}
    </div>
  </ArrivalRoot>
);

/**
 * The title column, a component of its own because the arrival state it reads
 * is the one {@link PageHead} provides: a hook called in the provider's own
 * render would see the arrival of whatever encloses the page instead.
 */
const PageHeadTitle = ({
  title,
  lede,
  size,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  size: "title" | "subtitle";
}) => {
  const titleArrival = useArrival("title");
  const ledeArrival = useArrival("byline");

  return (
    <div className={"min-w-0"}>
      <m.h1
        {...titleArrival}
        className={cn(
          "mt-3 font-heading tracking-[-0.01em] text-ink",
          size === "subtitle" ? "text-subtitle/none" : "text-title/none"
        )}
      >
        {title}
      </m.h1>
      {lede && (
        <m.p
          {...ledeArrival}
          className={"mt-2 max-w-[54ch] text-body text-ink-soft"}
        >
          {lede}
        </m.p>
      )}
    </div>
  );
};
