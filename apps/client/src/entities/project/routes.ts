import {
  declareRoute,
  pattern,
  type RouteDeclaration,
} from "@/lib/route-pattern";

/** The project's own routes: its root, its plugin and sample lists and its repos' pages. */
export const projectRoutes: readonly RouteDeclaration[] = [
  declareRoute({
    kind: "project",
    entity: "project",
    shows: "row",
    ...pattern<"project">([]),
  }),
  declareRoute({
    kind: "plugins",
    ...pattern<"plugins">([{ literal: "plugins" }]),
  }),
  declareRoute({
    kind: "samples",
    ...pattern<"samples">([{ literal: "samples" }]),
  }),
  declareRoute({
    kind: "repo",
    ...pattern<"repo">([{ literal: "repo", param: "repoId" }]),
  }),
];
