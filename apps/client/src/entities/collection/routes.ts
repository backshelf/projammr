import {
  declareRoute,
  pattern,
  type RouteDeclaration,
} from "@/lib/route-pattern";

/** The collection's own routes: one collection, the form for a new one, and the full list. */
export const collectionRoutes: readonly RouteDeclaration[] = [
  declareRoute({
    kind: "collection",
    entity: "collection",
    shows: "row",
    ...pattern<"collection">([
      { literal: "collection", param: "collectionId" },
    ]),
  }),
  declareRoute({
    kind: "collection-new",
    entity: "collection",
    shows: "row",
    ...pattern<"collection-new">([
      { literal: "collection" },
      { literal: "new" },
    ]),
  }),
  declareRoute({
    kind: "collection-all",
    entity: "collection",
    shows: "list",
    ...pattern<"collection-all">([
      { literal: "collection" },
      { literal: "all" },
    ]),
  }),
];
