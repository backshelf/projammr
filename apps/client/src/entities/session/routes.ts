import {
  COLLECTION_PARENT,
  declareRoute,
  pattern,
  type RouteDeclaration,
  TRACK_PARENT,
} from "@/lib/route-pattern";

/**
 * The session's own routes: one session, the form for a new one, the full
 * list, and one session's save history.
 */
export const sessionRoutes: readonly RouteDeclaration[] = [
  declareRoute({
    kind: "session",
    entity: "session",
    shows: "row",
    ...pattern<"session">([
      COLLECTION_PARENT,
      TRACK_PARENT,
      { literal: "session", param: "sessionId" },
    ]),
  }),
  declareRoute({
    kind: "session-new",
    entity: "session",
    shows: "row",
    ...pattern<"session-new">([
      COLLECTION_PARENT,
      TRACK_PARENT,
      { literal: "session" },
      { literal: "new" },
    ]),
  }),
  declareRoute({
    kind: "session-all",
    entity: "session",
    shows: "list",
    ...pattern<"session-all">([{ literal: "session" }, { literal: "all" }]),
  }),
  declareRoute({
    kind: "session-history",
    entity: "session",
    shows: "row",
    ...pattern<"session-history">([
      COLLECTION_PARENT,
      TRACK_PARENT,
      { literal: "session", param: "sessionId" },
      { literal: "history" },
    ]),
  }),
];
