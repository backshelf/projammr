import { collectionRoutes } from "@/entities/collection/routes";
import { projectRoutes } from "@/entities/project/routes";
import { sessionRoutes } from "@/entities/session/routes";
import { trackRoutes } from "@/entities/track/routes";
import type { RouteKind } from "@/lib/route-parser";
import type { RouteDeclaration } from "@/lib/route-pattern";

/**
 * Every route kind's declaration, in the project → collection → track →
 * session order the entities are read and rendered in. The order has no
 * effect on correctness — `route-pattern.test.ts` proves every valid path
 * matches exactly one declaration — but it keeps a shape closest to the
 * project root (the empty-segment match) checked first.
 */
export const ROUTES: readonly RouteDeclaration[] = [
  ...projectRoutes,
  ...collectionRoutes,
  ...trackRoutes,
  ...sessionRoutes,
];

/** Every kind `ROUTES` declares a lookup for; `not-found` is the fallback, not a declaration. */
type DeclaredRouteKind = Exclude<RouteKind, "not-found">;

const BY_KIND: Record<DeclaredRouteKind, RouteDeclaration> = Object.fromEntries(
  ROUTES.map((route) => [route.kind, route])
) as Record<DeclaredRouteKind, RouteDeclaration>;

/** The declaration for `kind`, looked up once from `ROUTES`. */
export const routeDeclaration = (kind: DeclaredRouteKind): RouteDeclaration =>
  BY_KIND[kind];
