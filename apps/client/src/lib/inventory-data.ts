import "server-only";
import { getProjectPlugins, getProjectSamples } from "@/actions/projects";
import { inventoryWeb } from "@/lib/inventory-web";
import { pluginsGraph, type PluginOrigin } from "@/lib/plugins-graph";
import { cachedPolicies } from "@/lib/policies/server";
import { samplesGraph, type SamplesShow } from "@/lib/samples-graph";
import {
  cachedSessionSummaries,
  cachedTrackSummaries,
} from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import { cache } from "react";

/*
 * The inventory pages' reads, once per request. The page (head, rows) and
 * its streamed web both need the same graph, so it is built once from the
 * request-cached reads and shared; the web's layout is memoised the same
 * way. Nothing is cached across requests: a scan can change a session at any
 * moment and nothing here would hear of it.
 */

const cachedProjectPlugins = cache(getProjectPlugins);
const cachedProjectSamples = cache(getProjectSamples);

/** Hands the event loop back between the layout's passes, so the page's head
 *  streams while the web settles and other requests are not held up. */
const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

async function sessionsAndTitles(projectId: number) {
  const [sessions, tracks] = await Promise.all([
    cachedSessionSummaries(projectId),
    cachedTrackSummaries(projectId),
  ]);
  return {
    sessions: isActionError(sessions) ? [] : sessions,
    trackTitles: isActionError(tracks)
      ? undefined
      : new Map(tracks.map((track) => [track.id, track.title])),
  };
}

/** The plugins page's usage and graph for one view. A failed read is an
 *  empty list. */
export const cachedPluginsGraph = cache(
  async (
    projectId: number,
    origin: PluginOrigin | undefined,
    stock: boolean
  ) => {
    const [usage, { sessions, trackTitles }, { shell }] = await Promise.all([
      cachedProjectPlugins(projectId),
      sessionsAndTitles(projectId),
      cachedPolicies(projectId),
    ]);
    const usageList = isActionError(usage) ? [] : usage;
    return {
      usage: usageList,
      graph: pluginsGraph(usageList, sessions, {
        projectId,
        origin,
        stock,
        defaults: shell.inventoryDefaults.plugins,
        trackTitles,
      }),
    };
  }
);

/** The plugins page's web: every device is a node (none folds), since the
 *  devices only one set carries are its distinctive gear. */
export const cachedPluginsWeb = cache(
  async (
    projectId: number,
    origin: PluginOrigin | undefined,
    stock: boolean
  ) => {
    const { graph } = await cachedPluginsGraph(projectId, origin, stock);
    await yieldToEventLoop();
    return inventoryWeb(graph, {
      minShared: 1,
      stock,
      item: "device",
      pause: yieldToEventLoop,
    });
  }
);

/** The samples page's usage and graph for one view. A failed read is an
 *  empty list. */
export const cachedSamplesGraph = cache(
  async (
    projectId: number,
    show: SamplesShow,
    library: boolean,
    stock: boolean
  ) => {
    const [usage, { sessions, trackTitles }, { shell }] = await Promise.all([
      cachedProjectSamples(projectId),
      sessionsAndTitles(projectId),
      cachedPolicies(projectId),
    ]);
    const usageList = isActionError(usage) ? [] : usage;
    return {
      usage: usageList,
      graph: samplesGraph(usageList, sessions, {
        projectId,
        show,
        library,
        stock,
        defaults: shell.inventoryDefaults.samples,
        trackTitles,
      }),
    };
  }
);

/** The samples page's web: a sample only one set uses folds into that set's
 *  "+n own", since the web is about what sets share. */
export const cachedSamplesWeb = cache(
  async (
    projectId: number,
    show: SamplesShow,
    library: boolean,
    stock: boolean
  ) => {
    const { graph } = await cachedSamplesGraph(projectId, show, library, stock);
    await yieldToEventLoop();
    return inventoryWeb(graph, {
      minShared: 2,
      stock,
      item: "sample",
      pause: yieldToEventLoop,
    });
  }
);
