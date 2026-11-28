import type { StatusDisplayType } from "@/components/status/StatusDisplay";
import type { PriorityLevel } from "@workspace/api/api";

import type { PeekField } from "../PeekPanel";

/**
 * A child row as the card's disclosure lists it. The grid draws a child cell
 * per parent column, which a list has none of, so a child gets its own one-line
 * projection instead.
 */
export type RowCardChild = {
  id: number;
  title: string;
  subtitle?: string;
  /** The child's own page. A child with nowhere to go is a plain line. */
  href?: string;
};

/**
 * A row the player can take: what the card's thumb and the action sheet play.
 * Absent on a row with no audio behind it.
 */
export type RowCardPlay = {
  kind: "track" | "collection";
  id: number;
  title: string;
};

/**
 * One row as a phone list draws it — the peek projection narrowed to what
 * fits on a single line, plus where the row's page is and what colour it
 * carries. Built by the table so a card renders without touching the row's
 * entity type.
 */
export type RowCardModel = {
  id: number;
  /** Position in the collection being viewed, when collection-scoped. */
  trackNumber?: number | null;
  /** The row's full page: tapping the card goes here. */
  href: string;
  title: string;
  subtitle?: string;
  image?: string | null;
  /** A mark beside the title for a boolean the row wears, such as "Main". */
  flag?: string;
  status?: StatusDisplayType | null;
  priority?: PriorityLevel;
  /** At most two, already chosen by `cardFieldsFrom`. */
  fields: PeekField[];
  /** The rows the card discloses. Empty or absent means no expand affordance. */
  children?: RowCardChild[];
  play?: RowCardPlay;
  /**
   * The row's position in the table's page rows — the same index
   * `scrollToIndex` takes. Set by the table, not by `cardFieldsFrom`, since it
   * comes from the row model rather than the peek projection.
   */
  rowIndex: number;
};
