import type {
  Collection,
  CustomFieldKind,
  EntityKind,
  Project,
  Session,
  Track,
} from "@workspace/api/api";
import type { ParsedRoute } from "@/lib/route-parser";

/** A kind's name, lower case; callers capitalise. */
export type EntityNouns = { singular: string; plural: string };

/** The rows a route was reached through, when its own id is not enough. */
export type RouteParents = { collectionId?: number; trackId?: number };

type LabelSource = {
  project: Pick<Project, "name">;
  collection: Pick<Collection, "title">;
  track: Pick<Track, "title">;
  session: Pick<Session, "name">;
};

export type EntityModule<K extends EntityKind = EntityKind> = {
  kind: K;
  /** Lower case; callers capitalise. */
  nouns: EntityNouns;
  /** Whether rows of this kind carry a `statusId`. */
  hasStatus: boolean;
  /** The kind of custom field a project defines for rows of this kind, which
   *  carry the values in a `fields` bag; null for a kind with none. */
  customFieldKind: CustomFieldKind | null;
  /** The text a row of this kind is known by. */
  labelOf: (row: LabelSource[K]) => string;
  /** The route of a row's own page, given the rows it was reached through. */
  pageRoute: (id: number, parents: RouteParents) => ParsedRoute;
  /** The route that lists every row of this kind; null when no such page exists. */
  listRoute: ParsedRoute | null;
  /** The route of this kind's create page; null when the kind has none. */
  newRoute: ParsedRoute | null;
  /** The first line of a file drop zone attached to a row of this kind. */
  dropPrompt: string;
};
