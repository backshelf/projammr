import type { ParsedRoute, RouteKind } from "@/lib/route-parser";
import type { ReactNode } from "react";

export type RouteSearchParams = Record<string, string | string[] | undefined>;

/** A parsed route together with the project it is scoped to. */
type RouteFor<K extends RouteKind> = Extract<ParsedRoute, { kind: K }> & {
  projectId: number;
};

type TypedRouteModule<K extends RouteKind> = {
  /** The document title for routes that do not name an entity. */
  title?: string;
  /** The entity's name, for routes that do name one. */
  loadTitle?: (route: RouteFor<K>) => Promise<string | undefined>;
  Page: (props: {
    route: RouteFor<K>;
    searchParams: RouteSearchParams;
  }) => ReactNode;
};

export type RouteModule = TypedRouteModule<RouteKind>;

/**
 * Binds a module to a single route kind, so `Page` and `loadTitle` are written
 * against that kind's own shape while the registry holds them all uniformly.
 */
export const routeModule = <K extends RouteKind>(
  module: TypedRouteModule<K>
): RouteModule => module as RouteModule;

export const searchParam = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * A flag the URL can set either way: `1` is on and `0` off. Anything else
 * (absent, or repeated, as `searchParam` reads it) is `fallback`: the
 * viewer's default for the flag, or `undefined` for a caller that resolves
 * the default itself.
 */
export const flagOr = <F extends boolean | undefined>(
  value: string | string[] | undefined,
  fallback: F
): boolean | F => {
  const raw = searchParam(value);
  return raw === "1" ? true : raw === "0" ? false : fallback;
};
