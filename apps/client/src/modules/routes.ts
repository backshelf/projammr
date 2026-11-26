import type { RouteKind } from "@/lib/route-parser";
import { collectionRoutes } from "@/modules/collection";
import { projectRoutes } from "@/modules/project";
import type { RouteModule } from "@/modules/route-module";
import { sessionRoutes } from "@/modules/session";
import { trackRoutes } from "@/modules/track";

/** Every route kind the project sub-router can render, and how to render it. */
const ROUTE_MODULES: Record<Exclude<RouteKind, "not-found">, RouteModule> = {
  ...projectRoutes,
  ...trackRoutes,
  ...collectionRoutes,
  ...sessionRoutes,
};

export const routeModuleFor = (kind: RouteKind): RouteModule | undefined =>
  kind === "not-found" ? undefined : ROUTE_MODULES[kind];
