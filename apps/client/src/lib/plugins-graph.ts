import type { WebCable } from "@/lib/inventory-web";
import type { InventoryDefaults } from "@/lib/policies/shell";
import { setNodes } from "@/lib/set-nodes";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { PluginUsage, SessionSummary } from "@workspace/api/api";
import type { PatchNode } from "@workspace/ui/lib/patchbay";

/** A device's origin: one of the DAW's own, or a third-party plugin. */
export type PluginOrigin = PluginUsage["origin"];

/** What the plugins page's URL can say: `?origin=` (`all`, or one origin),
 *  `?stock=1` or `0`, `?device=`. A view param left out is the viewer's
 *  default for it. */
export type PluginsPageParams = {
  origin?: "all" | PluginOrigin;
  /** Draws the stock chain in the web. */
  stock?: boolean;
  device?: string;
};

/** The plugins page's view when its URL does not say: the viewer's defaults. */
export type PluginsDefaults = InventoryDefaults["plugins"];

/**
 * `/project/:id/plugins` with its params, each view param left out when it is
 * the viewer's default (`defaults`), so the plain page has the plain URL.
 * Every link into the page (a tab, a node, a row, a compact section's "All
 * devices") goes through this.
 */
export function pluginsPageHref(
  projectId: number,
  { origin, stock, device }: PluginsPageParams,
  defaults: PluginsDefaults
): string {
  const params = new URLSearchParams();
  if (origin !== undefined && origin !== defaults.origin) {
    params.set("origin", origin);
  }
  if (stock !== undefined && stock !== defaults.stock) {
    params.set("stock", stock ? "1" : "0");
  }
  if (device !== undefined) params.set("device", device);
  const query = params.toString();
  const base = hrefFromParsedRoute({ kind: "plugins" }, projectId);
  return query ? `${base}?${query}` : base;
}

/** "Xfer Records · VST3", or "Built-in" for one of the DAW's own devices. */
export function deviceMeta(plugin: PluginUsage): string {
  if (plugin.origin === "builtin") return "Built-in";
  const parts = [plugin.manufacturer, plugin.host?.toUpperCase()].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(" · ") : "Third-party";
}

export type PluginsGraphOptions = {
  projectId: number;
  /** Keeps only devices of this origin, in the graph and the rows alike. */
  origin?: PluginOrigin;
  /** Carried on every device's link, so opening a row keeps the stock chain drawn. */
  stock?: boolean;
  /** The viewer's defaults, which every device's link is written against. */
  defaults: PluginsDefaults;
  /** Track titles by id, for a set's meta line; a set with no track has none. */
  trackTitles?: ReadonlyMap<number, string>;
};

export type PluginsGraph = {
  /** The devices the origin keeps, in the server's order (most used first): the rows. */
  plugins: PluginUsage[];
  /** Sets carrying a kept device, in `sessions`' order; ids are session ids as strings. */
  left: PatchNode[];
  /** Every kept device; ids are its name. `layoutPatchbay` folds single-set ones into "+n own". */
  right: PatchNode[];
  /** One per device and set, with `uses` the set's track entries carrying it. */
  cables: WebCable[];
  /**
   * The lede's numbers. They ignore the tab, so switching to Built-in does
   * not change the head: devices, the sets carrying any of them, and the
   * third-party ones.
   */
  counts: { devices: number; sets: number; thirdParty: number };
};

/**
 * Turns the project's device usage and its session list into what the
 * Patchbay and the rows draw: sets down the left rail (each linking to its
 * session), devices down the right (each linking to its row on the plugins
 * page), one cable per use. A session id the list does not know (deleted
 * between the two reads) is left out with its cables; a device with no
 * session ids gets no cable but keeps its row.
 */
export function pluginsGraph(
  usage: readonly PluginUsage[],
  sessions: readonly SessionSummary[],
  { projectId, origin, stock, defaults, trackTitles }: PluginsGraphOptions
): PluginsGraph {
  const known = new Set(sessions.map((session) => session.id));

  const counts = {
    devices: usage.length,
    sets: new Set(
      usage.flatMap((plugin) => plugin.sessionIds.filter((id) => known.has(id)))
    ).size,
    thirdParty: usage.filter((plugin) => plugin.origin === "plugin").length,
  };

  const plugins = usage.filter(
    (plugin) => origin === undefined || plugin.origin === origin
  );

  const cables: WebCable[] = [];
  const used = new Set<number>();
  for (const plugin of plugins) {
    plugin.sessionIds.forEach((id, at) => {
      if (!known.has(id)) return;
      used.add(id);
      cables.push({
        left: String(id),
        right: plugin.name,
        uses: plugin.sessionTracks[at] ?? 1,
      });
    });
  }

  const left = setNodes(sessions, used, { projectId, trackTitles });

  const right: PatchNode[] = plugins.map((plugin) => ({
    id: plugin.name,
    label: plugin.name,
    meta: deviceMeta(plugin),
    href: pluginsPageHref(
      projectId,
      { origin: origin ?? "all", stock, device: plugin.name },
      defaults
    ),
  }));

  return { plugins, left, right, cables, counts };
}
