"use client";

import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { AppLink } from "@/components/navigation/AppLink";
import { type CurrentRoute, useCurrentRoute } from "@/hooks/use-current-route";
import { errorCopy, notFoundCopy, type RouteCopy } from "@/lib/route-copy";
import type { ParsedRoute } from "@/lib/route-parser";
import { hrefFromParsedRoute } from "@/lib/utils";
import { Button } from "@workspace/ui/components/button";

/** The address `copy`'s link goes to: a route under the current project, or "/" with no project to scope it to. */
const linkHref = (current: CurrentRoute | null, copy: RouteCopy): string =>
  current ? hrefFromParsedRoute(copy.link.route, current.projectId) : "/";

/** The route the current URL names, or the page fallback with no project to read one from. */
const NO_PROJECT_ROUTE: ParsedRoute = { kind: "not-found" };

/**
 * The project shell's `not-found.tsx`: keeps `TopStrip` and the project role
 * provider mounted while a module page's `notFound()` replaces only the page
 * area below them.
 */
export function RouteNotFound() {
  const current = useCurrentRoute();
  const copy = notFoundCopy(current?.route ?? NO_PROJECT_ROUTE);

  return (
    <CenteredPageShell inShell title={copy.title} body={copy.body}>
      <Button asChild>
        <AppLink href={linkHref(current, copy)}>{copy.link.label}</AppLink>
      </Button>
    </CenteredPageShell>
  );
}

/**
 * The project shell's `error.tsx`: keeps `TopStrip` and the project role
 * provider mounted while a module page's thrown error replaces only the page
 * area below them.
 */
export function RouteError({ retry }: { retry: () => void }) {
  const current = useCurrentRoute();
  const copy = errorCopy(current?.route ?? NO_PROJECT_ROUTE);

  return (
    <CenteredPageShell inShell title={copy.title} body={copy.body}>
      <div className="flex items-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="ghost" asChild>
          <AppLink href={linkHref(current, copy)}>{copy.link.label}</AppLink>
        </Button>
      </div>
    </CenteredPageShell>
  );
}
