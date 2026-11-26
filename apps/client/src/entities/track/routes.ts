import {
  COLLECTION_PARENT,
  declareRoute,
  pattern,
  type RouteDeclaration,
} from "@/lib/route-pattern";

/** The track's own routes: one track, the form for a new one, and the full list. */
export const trackRoutes: readonly RouteDeclaration[] = [
  declareRoute({
    kind: "track",
    entity: "track",
    shows: "row",
    ...pattern<"track">([
      COLLECTION_PARENT,
      { literal: "track", param: "trackId" },
    ]),
  }),
  declareRoute({
    kind: "track-new",
    entity: "track",
    shows: "row",
    ...pattern<"track-new">([
      COLLECTION_PARENT,
      { literal: "track" },
      { literal: "new" },
    ]),
  }),
  declareRoute({
    kind: "track-all",
    entity: "track",
    shows: "list",
    ...pattern<"track-all">([{ literal: "track" }, { literal: "all" }]),
  }),
  declareRoute({
    kind: "track-archived",
    entity: "track",
    shows: "list",
    ...pattern<"track-archived">([
      { literal: "track" },
      { literal: "archived" },
    ]),
  }),
];
