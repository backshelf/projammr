import { parseId } from "@/lib/route-pattern";
import { parseRoute } from "@/lib/route-parser";
import { settingsHref } from "@/lib/settings/href";
import { routeModuleFor } from "@/modules/routes";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{ projectId: string; route: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const routeFrom = async (params: Props["params"]) => {
  const { projectId, route } = await params;
  const id = parseId(projectId);
  if (id === null) return null;
  return { ...parseRoute(route), projectId: id };
};

/**
 * `settings[/<pane>]` under a project names that project's settings, which
 * live in the settings hub: the Project section, at the pane when one is named.
 */
function hubHref(projectId: string, segments: string[]): string | null {
  const [head, pane, ...deeper] = segments;
  const id = parseId(projectId);
  if (head !== "settings" || deeper.length > 0 || id === null) return null;
  return settingsHref({ section: "project", projectId: id, group: pane });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const route = await routeFrom(params);
  if (route === null) return {};
  const entry = routeModuleFor(route.kind);

  const title = entry?.title ?? (await entry?.loadTitle?.(route));

  return title ? { title } : {};
}

export default async function ProjectRouter({ params, searchParams }: Props) {
  const { projectId, route: segments } = await params;
  const hub = hubHref(projectId, segments);
  if (hub !== null) redirect(hub);

  const route = await routeFrom(params);
  if (route === null) return notFound();
  const entry = routeModuleFor(route.kind);

  if (!entry) {
    return notFound();
  }

  return entry.Page({ route, searchParams: await searchParams });
}
