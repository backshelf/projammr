import type { EntityKind } from "@workspace/api/api";
import type { ParsedRoute, RouteKind } from "@/lib/route-parser";

type RouteParam = "collectionId" | "trackId" | "sessionId" | "repoId";
export type RoutePart = {
  literal: string;
  param?: RouteParam;
  optional?: true;
};
export type RouteParams = Partial<Record<RouteParam, number>>;

/** The optional collection a track's or a session's URL can be scoped under. */
export const COLLECTION_PARENT: RoutePart = {
  literal: "collection",
  param: "collectionId",
  optional: true,
};

/** The optional track a session's URL can be scoped under. */
export const TRACK_PARENT: RoutePart = {
  literal: "track",
  param: "trackId",
  optional: true,
};

const CANONICAL_ID = /^[1-9]\d*$/;

/** A canonical positive integer: no sign, no leading zero, no exponent, within the safe range. */
export const parseId = (segment: string | undefined): number | null => {
  if (segment === undefined || !CANONICAL_ID.test(segment)) return null;
  const id = Number(segment);
  return Number.isSafeInteger(id) ? id : null;
};

/**
 * Walks `parts` in order. A part whose literal is not the next segment is
 * skipped when optional and fails the match otherwise; a part whose literal
 * matches must be followed by a canonical id when it binds one. Every segment
 * has to be consumed.
 */
const matchParts = (
  parts: readonly RoutePart[],
  segments: readonly string[]
): RouteParams | null => {
  const params: RouteParams = {};
  let at = 0;
  for (const part of parts) {
    if (segments[at] !== part.literal) {
      if (part.optional) continue;
      return null;
    }
    at += 1;
    if (!part.param) continue;
    const id = parseId(segments[at]);
    if (id === null) return null;
    params[part.param] = id;
    at += 1;
  }
  return at === segments.length ? params : null;
};

const buildParts = (
  parts: readonly RoutePart[],
  params: RouteParams
): string[] =>
  parts.flatMap((part) => {
    if (!part.param) return [part.literal];
    const id = params[part.param];
    return id === undefined ? [] : [part.literal, String(id)];
  });

/** The member of `ParsedRoute` for one route kind. */
type RouteOf<K extends RouteKind> = Extract<ParsedRoute, { kind: K }>;

export type RouteDeclaration<K extends RouteKind = RouteKind> = {
  kind: K;
  /** The route's params when `segments` is exactly this route's URL shape, else null. */
  match: (segments: readonly string[]) => Omit<RouteOf<K>, "kind"> | null;
  /** The segments under `/project/:projectId` that address `route`. */
  build: (route: RouteOf<K>) => string[];
  /** The entity kind whose nouns word this route's not-found and error copy; absent for a page that names no kind. */
  entity?: EntityKind;
  /** Whether the route shows one row or many; set exactly when `entity` is. */
  shows?: "row" | "list";
};

/**
 * A `{ match, build }` pair over `parts`, typed to one route kind so the ids
 * `match` returns and the route `build` accepts line up with that kind's own
 * shape in `ParsedRoute`.
 */
export const pattern = <K extends RouteKind>(
  parts: readonly RoutePart[]
): {
  match: (segments: readonly string[]) => Omit<RouteOf<K>, "kind"> | null;
  build: (route: RouteOf<K>) => string[];
} => ({
  match: (segments) =>
    matchParts(parts, segments) as Omit<RouteOf<K>, "kind"> | null,
  build: (route) => buildParts(parts, route as RouteParams),
});

/**
 * Binds a declaration to one kind, the way `routeModule` binds a page module:
 * `K` is inferred from the `kind` literal so `match` and `build` are checked
 * against that kind's own member of `ParsedRoute`, then widened to the
 * uniform type a registry holds every kind's declaration as.
 */
export const declareRoute = <K extends RouteKind>(
  declaration: RouteDeclaration<K>
): RouteDeclaration => declaration as unknown as RouteDeclaration;
