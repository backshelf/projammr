"use client";

import { parseId } from "@/lib/route-pattern";
import { parseRoute, type ParsedRoute } from "@/lib/route-parser";
import { useParams } from "next/navigation";
import { useMemo } from "react";

export type CurrentRoute = { projectId: number; route: ParsedRoute };

/**
 * The project the URL is scoped to and the route within it, or `null`
 * everywhere outside `/project/:id` — `/`, `/profile`, `/invite/*` and
 * `/project/new`, none of which belong to a project.
 */
export function useCurrentRoute(): CurrentRoute | null {
  const params = useParams<{ projectId?: string; route?: string[] }>();

  return useMemo(() => {
    const projectId = parseId(params.projectId);
    if (projectId === null) return null;

    return { projectId, route: parseRoute(params.route ?? []) };
  }, [params]);
}
