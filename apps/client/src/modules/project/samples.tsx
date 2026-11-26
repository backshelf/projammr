import { getSampleSessions } from "@/actions/projects";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { InventoryPage } from "@/components/inventory/InventoryPage";
import { SampleRows } from "@/components/inventory/SampleRows";
import { cachedSamplesGraph, cachedSamplesWeb } from "@/lib/inventory-data";
import { loaded } from "@/lib/loaded";
import { samplesPageHref, type SamplesShow } from "@/lib/samples-graph";
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

const SHOW_TABS: { value: SamplesShow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
];

const showParam = (
  value: string | string[] | undefined,
  fallback: SamplesShow
): SamplesShow => {
  const raw = searchParam(value);
  return raw === "missing" || raw === "all" ? raw : fallback;
};

export default async function SamplesPage({
  projectId,
  searchParams,
}: {
  projectId: number;
  searchParams: RouteSearchParams;
}) {
  const { shell } = await cachedPolicies(projectId);
  const defaults = shell.inventoryDefaults.samples;
  const show = showParam(searchParams.show, defaults.show);
  const library = flagOr(searchParams.library, defaults.library);
  const stock = flagOr(searchParams.stock, defaults.stock);
  const sample = searchParam(searchParams.sample);

  // Every read starts together, the open row's sets included, so an expanded
  // row arrives no later than the list it sits under. The web lays itself out
  // from the same reads once the head is on its way.
  const [projectResult, { usage, graph }, sampleSessions] = await Promise.all([
    cachedProject(projectId),
    cachedSamplesGraph(projectId, show, library, stock),
    sample ? getSampleSessions(projectId, sample) : null,
  ]);

  const project = loaded(projectResult);
  const { counts } = graph;
  const lede = [
    `${pluralizeCount(counts.samples, "sample")} across ${pluralizeCount(counts.sets, "set")}`,
    `${counts.shared} shared by more than one`,
    `${counts.missing} missing`,
  ].join(" · ");

  const emptyLine =
    usage.length === 0
      ? "No set has reported its samples yet. Scan a project folder to fill this."
      : show === "missing"
        ? "Nothing missing."
        : "Every sample is in the Library. Turn Library on to see them.";

  return (
    <InventoryPage
      crumbs={
        <Breadcrumbs
          crumbs={[
            ...createBreadcrumbs(project),
            {
              label: "Samples",
              href: hrefFromParsedRoute({ kind: "samples" }, projectId),
            },
          ]}
        />
      }
      title="Samples"
      lede={lede}
      filters={{
        tabs: {
          param: "show",
          active: show,
          fallback: defaults.show,
          items: SHOW_TABS,
        },
        searchPlaceholder: "Search samples",
        library: {
          param: "library",
          on: library,
          fallback: defaults.library,
          label: "Library",
        },
        expandParam: "sample",
      }}
      web={
        usage.length === 0
          ? undefined
          : {
              layout: () => cachedSamplesWeb(projectId, show, library, stock),
              label: lede,
              stock,
              toggleHref: samplesPageHref(
                projectId,
                { show, library, stock: !stock, sample },
                defaults
              ),
            }
      }
      rows={
        <SampleRows
          projectId={projectId}
          samples={graph.samples}
          view={{ show, library, stock }}
          emptyLine={emptyLine}
          expanded={
            sample && sampleSessions
              ? {
                  path: sample,
                  sessions: isActionError(sampleSessions) ? [] : sampleSessions,
                }
              : undefined
          }
        />
      }
    />
  );
}
