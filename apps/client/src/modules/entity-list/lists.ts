import type { getCollectionsPageForProject } from "@/actions/projects";
import type { getSessionsPageForProject } from "@/actions/sessions";
import type { getTracksPageForProject } from "@/actions/tracks";
import type { EntityTableScope } from "@/entities/table-types";
import { collectionList } from "@/entities/collection/list";
import { sessionList } from "@/entities/session/list";
import { trackList } from "@/entities/track/list";
import type { ParsedRoute } from "@/lib/route-parser";
import type { TableSearchParams } from "@/lib/table-params";
import type { TableEntityKind, TracksPageQuery } from "@workspace/api/api";

/**
 * The server action that loads one page of each kind's list. Type-only, so the
 * actions stay out of this file's runtime imports.
 */
export type PageLoader = {
  track: typeof getTracksPageForProject;
  session: typeof getSessionsPageForProject;
  collection: typeof getCollectionsPageForProject;
};

/** What a kind's list page needs beyond what its entity module already says. */
export type EntityListConfig<K extends TableEntityKind> = {
  kind: K;
  /** "Every DAW session in": the page appends the project name and the count. */
  ledeOpening: string;
  /**
   * Loads the page, forwarding the query params this kind's server filters
   * read. `archived` is the archived scope the page is in; a kind without an
   * archived axis ignores it. `pageSize` is the caller's resolved
   * `tables.rowsPerLoad`.
   */
  loadPage: (
    projectId: number,
    query: TableSearchParams,
    archived?: TracksPageQuery["archived"],
    pageSize?: number
  ) => ReturnType<PageLoader[K]>;
  /** Loads the lists the kind's table offers in its pickers. */
  loadScope: (projectId: number) => Promise<EntityTableScope[K]>;
  /**
   * Set only on a kind whose rows can be archived; its presence gives the kind
   * an archived list page. `route` is that page, and `count` the number of
   * archived rows in a project (0 when the count cannot be loaded).
   */
  archived?: {
    route: ParsedRoute;
    count: (projectId: number) => Promise<number>;
  };
};

/** Every kind's list page config; `EntityList` renders any of them. */
export const ENTITY_LISTS: { [K in TableEntityKind]: EntityListConfig<K> } = {
  collection: collectionList,
  session: sessionList,
  track: trackList,
};
