import { getPluginSessions } from "@/actions/projects";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { InventoryPage } from "@/components/inventory/InventoryPage";
import { PluginRows } from "@/components/inventory/PluginRows";
import { cachedPluginsGraph, cachedPluginsWeb } from "@/lib/inventory-data";
import { loaded } from "@/lib/loaded";
import { pluginsPageHref, type PluginOrigin } from "@/lib/plugins-graph";
import { cachedProject } from "@/lib/server-data";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { cachedPolicies } from "@/lib/policies/server";
import {
  flagOr,
  searchParam,
  type RouteSearchParams,
} from "@/modules/route-module";
import { isActionError } from "@workspace/api/lib/action-result";
import { pluralizeCount } from "@workspace/session-diff/format";

const ORIGIN_TABS: { value: "all" | PluginOrigin; label: string }[] = [
  { value: "all", label: "All" },
  { value: "plugin", label: "Plugins" },
  { value: "builtin", label: "Built-in" },
];

const originParam = (
  value: string | string[] | undefined,
  fallback: "all" | PluginOrigin
): "all" | PluginOrigin => {
  const raw = searchParam(value);
  return raw === "all" || raw === "plugin" || raw === "builtin"
    ? raw
    : fallback;
};

export default async function PluginsPage({
  projectId,
  searchParams,
}: {
  projectId: number;
  searchParams: RouteSearchParams;
}) {
  const { shell } = await cachedPolicies(projectId);
  const defaults = shell.inventoryDefaults.plugins;
  const tab = originParam(searchParams.origin, defaults.origin);
  // The graph keeps every origin for "all".
  const origin = tab === "all" ? undefined : tab;
  const stock = flagOr(searchParams.stock, defaults.stock);
  const device = searchParam(searchParams.device);

  // Every read starts together, the open row's sessions included, so an
  // expanded row arrives no later than the list it sits under. The web lays
  // itself out from the same reads once the head is on its way.
  const [projectResult, { usage, graph }, deviceSessions] = await Promise.all([
    cachedProject(projectId),
    cachedPluginsGraph(projectId, origin, stock),
    device ? getPluginSessions(projectId, device) : null,
  ]);

  const project = loaded(projectResult);
  const { counts } = graph;
  const lede = `${pluralizeCount(counts.devices, "device")} across ${pluralizeCount(counts.sets, "set")} · ${counts.thirdParty} third-party`;

  const emptyLine =
    usage.length === 0
      ? "No devices yet. Track a project folder with dit to read what its sessions use."
      : "Nothing here.";

  return (
    <InventoryPage
      crumbs={
        <Breadcrumbs
          crumbs={[
            ...createBreadcrumbs(project),
            {
              label: "Plugins",
              href: hrefFromParsedRoute({ kind: "plugins" }, projectId),
            },
          ]}
        />
      }
      title="Plugins"
      lede={lede}
      filters={{
        tabs: {
          param: "origin",
          active: tab,
          fallback: defaults.origin,
          items: ORIGIN_TABS,
        },
        searchPlaceholder: "Search devices",
        expandParam: "device",
      }}
      web={
        usage.length === 0
          ? undefined
          : {
              layout: () => cachedPluginsWeb(projectId, origin, stock),
              label: lede,
              stock,
              toggleHref: pluginsPageHref(
                projectId,
                { origin: tab, stock: !stock, device },
                defaults
              ),
            }
      }
      rows={
        <PluginRows
          projectId={projectId}
          plugins={graph.plugins}
          origin={origin}
          stock={stock}
          emptyLine={emptyLine}
          expanded={
            device && deviceSessions
              ? {
                  device,
                  sessions: isActionError(deviceSessions) ? [] : deviceSessions,
                }
              : undefined
          }
        />
      }
    />
  );
}
