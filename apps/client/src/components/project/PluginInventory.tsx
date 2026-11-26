import { AppLink } from "@/components/navigation/AppLink";
import { pluginsGraph, pluginsPageHref } from "@/lib/plugins-graph";
import { cachedPolicies } from "@/lib/policies/server";
import { cachedSessionSummaries } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import type { PluginUsage } from "@workspace/api/api";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { Patchbay } from "@workspace/ui/components/patchbay/patchbay";
import { PatchbayControls } from "@workspace/ui/components/patchbay/patchbay-controls";
import { pluralizeCount } from "@workspace/session-diff/format";
import { layoutPatchbay } from "@workspace/ui/lib/patchbay";

/** How many sets and devices the compact patchbay draws before "+n more". */
const MAX_SETS = 8;
const MAX_DEVICES = 12;

/**
 * The project page's plugins section: the lede's counts, a compact patchbay of
 * the sets and the devices they carry, and a link to the full page. A DAW's
 * own built-in devices sit in the bay alongside third-party plugins, since a
 * project's chain is as much its stock reverb and EQ as anything reached for.
 * Renders nothing when no session reports a device, or when the session read
 * fails.
 */
export async function PluginInventory({
  projectId,
  plugins,
}: {
  projectId: number;
  plugins: PluginUsage[];
  /** The project page still passes it; the set count comes from the graph. */
  sessionCount: number;
}) {
  if (plugins.length === 0) return null;

  const [sessions, { shell }] = await Promise.all([
    cachedSessionSummaries(projectId),
    cachedPolicies(projectId),
  ]);
  if (isActionError(sessions)) return null;

  const defaults = shell.inventoryDefaults.plugins;
  const graph = pluginsGraph(plugins, sessions, { projectId, defaults });
  const layout = layoutPatchbay(graph.left, graph.right, graph.cables, {
    maxLeft: MAX_SETS,
    maxRight: MAX_DEVICES,
  });
  const { counts } = graph;
  const lede = `${pluralizeCount(counts.devices, "device")} across ${pluralizeCount(counts.sets, "set")}`;

  return (
    <div>
      <SectionHead
        count={counts.devices}
        action={
          <AppLink
            href={pluginsPageHref(projectId, {}, defaults)}
            className="text-micro text-ink-soft hover:text-ink"
          >
            All devices
          </AppLink>
        }
      >
        PLUGINS
      </SectionHead>
      <p className="pb-3 text-micro text-ink-soft tabular-nums">{lede}</p>
      <PatchbayControls>
        <Patchbay
          layout={layout}
          leftHead="Sets"
          rightHead="Devices"
          summary={lede}
          link={AppLink}
        />
      </PatchbayControls>
    </div>
  );
}
