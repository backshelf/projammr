import type { ParsedRoute } from "@/lib/route-parser";

/**
 * Whether the command palette belongs on this page. It is mounted on every
 * signed-in page and renders on all of them — `/`, `/profile`, `/notes`,
 * `/settings` and the rest, where whatever needs a project is simply not
 * offered — except a URL inside a project that no route resolves.
 */
export function shouldRenderPalette(
  projectId: number | undefined,
  route: ParsedRoute
): boolean {
  return projectId === undefined || route.kind !== "not-found";
}
