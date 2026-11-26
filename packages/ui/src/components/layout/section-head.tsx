import {
  SECTION_HEAD,
  SECTION_TITLE,
  SECTION_TITLE_PRIMARY,
} from "@workspace/ui/lib/shell";
import React from "react";

/** How loudly a section's head speaks: `primary` for the sections a page is
 *  for, `default` for everything around them. */
export type SectionProminence = "default" | "primary";

export const sectionTitle = (prominence: SectionProminence = "default") =>
  prominence === "primary" ? SECTION_TITLE_PRIMARY : SECTION_TITLE;

/** The count beside a section title. A visually hidden comma breaks the
 *  count out of the heading's accessible name instead of running into the
 *  title — "COMMENTS, 2" rather than "COMMENTS2" — with nothing added on
 *  screen. */
export const SectionCount = ({ children }: { children: React.ReactNode }) => (
  <span className={"ml-2 text-micro text-ink-soft tabular-nums"}>
    <span className={"sr-only"}>, </span>
    {children}
  </span>
);

/**
 * Content-area section head: a quiet tracked-caps title with an optional
 * count and an action slot on the same baseline. No rules, no cards — the
 * heading is the structure. `as="h3"` heads a group inside a section whose
 * own head is the `h2`; `as="h4"` a group inside an `h3` item of a section's
 * list (one device's settings).
 */
export const SectionHead = ({
  as: Heading = "h2",
  ...props
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  action?: React.ReactNode;
  prominence?: SectionProminence;
  as?: "h2" | "h3" | "h4";
}) => (
  <div className={SECTION_HEAD}>
    <Heading className={sectionTitle(props.prominence)}>
      {props.children}
      {props.count != null && <SectionCount>{props.count}</SectionCount>}
    </Heading>
    {props.action}
  </div>
);
