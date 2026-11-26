import type { EntityModule } from "@/entities/types";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { EntityListConfig } from "@/modules/entity-list/lists";
import type { TableEntityKind } from "@workspace/api/api";

/** The words a kind's list page is made of. */
export type ListCopy = {
  title: string;
  crumb: string;
  newLabel: string;
  /** Carries the count once it is known, and reads whole without it. */
  lede: string;
};

/**
 * The strings of a kind's list page, from what the kind's module says about
 * its nouns and what its list config says about the lede. Kept apart from the
 * config so a test can build it without loading the page actions behind it.
 */
export function listCopy(
  module: Pick<EntityModule, "nouns">,
  config: Pick<EntityListConfig<TableEntityKind>, "ledeOpening">,
  projectName: string,
  count?: number
): ListCopy {
  const { singular, plural } = module.nouns;
  const opening = `${config.ledeOpening} ${projectName}`;
  return {
    title: `All ${plural}`,
    crumb: `All ${plural}`,
    newLabel: `New ${singular}`,
    lede:
      count === undefined
        ? `${opening}.`
        : `${opening} — ${pluralizeCount(count, singular)}.`,
  };
}

/** The words a kind's archived list page is made of. */
export type ArchivedListCopy = {
  title: string;
  crumb: string;
  /** Carries the count once it is known, and reads whole without it. */
  lede: string;
  /** Stands in for the table when nothing is archived. */
  empty: string;
};

/** The strings of a kind's archived list page, from the kind's nouns. */
export function archivedListCopy(
  module: Pick<EntityModule, "nouns">,
  count?: number
): ArchivedListCopy {
  const { singular, plural } = module.nouns;
  return {
    title: `Archived ${plural}`,
    crumb: "Archived",
    lede:
      count === undefined
        ? "Hidden from Tracks and Sessions"
        : `${pluralizeCount(count, `archived ${singular}`)} · hidden from Tracks and Sessions`,
    empty: "Nothing archived yet",
  };
}
