import { getProjectSamples } from "@/actions/projects";
import { AppLink } from "@/components/navigation/AppLink";
import { SamplesLibraryToggle } from "@/components/project/SamplesLibraryToggle";
import { cachedPolicies } from "@/lib/policies/server";
import { samplesGraph, samplesPageHref } from "@/lib/samples-graph";
import { cachedSessionSummaries } from "@/lib/server-data";
import { hrefFromParsedRoute } from "@/lib/utils";
import { isActionError } from "@workspace/api/lib/action-result";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { Patchbay } from "@workspace/ui/components/patchbay/patchbay";
import { PatchbayControls } from "@workspace/ui/components/patchbay/patchbay-controls";
import { pluralizeCount } from "@workspace/session-diff/format";
import { layoutPatchbay } from "@workspace/ui/lib/patchbay";

/** How many sets and shared samples the compact patchbay draws before "+n more". */
const MAX_SETS = 8;
const MAX_SAMPLES = 12;

/**
 * The project page's samples section: the lede's counts, a compact patchbay of
 * the sets and the samples they share, a Library toggle and a link to the full
 * page. Renders nothing when no session references a sample, or when either
 * read fails. The emptiness check is on the unfiltered usage, so a project
 * whose samples are all Library ones still shows the section with the toggle
 * off.
 */
export async function SamplesInventory({
  projectId,
  library,
}: {
  projectId: number;
  library: boolean;
}) {
  const [usage, sessions, { shell }] = await Promise.all([
    getProjectSamples(projectId),
    cachedSessionSummaries(projectId),
    cachedPolicies(projectId),
  ]);
  if (isActionError(usage) || isActionError(sessions)) return null;
  if (usage.length === 0) return null;

  const defaults = shell.inventoryDefaults.samples;
  const graph = samplesGraph(usage, sessions, {
    projectId,
    show: "all",
    library,
    defaults,
  });
  const layout = layoutPatchbay(graph.left, graph.right, graph.cables, {
    maxLeft: MAX_SETS,
    maxRight: MAX_SAMPLES,
  });
  const { counts } = graph;
  const lede = [
    `${pluralizeCount(counts.samples, "sample")} across ${pluralizeCount(counts.sets, "set")}`,
    `${counts.shared} shared`,
    `${counts.missing} missing`,
  ].join(" · ");

  const projectHref = hrefFromParsedRoute({ kind: "project" }, projectId);
  // The toggle's other state, left out of the URL when it is the default.
  const toggled = !library;
  const toggleHref =
    toggled === defaults.library
      ? projectHref
      : `${projectHref}?library=${toggled ? "1" : "0"}`;

  return (
    <div>
      <SectionHead
        count={counts.samples}
        action={
          <AppLink
            href={samplesPageHref(projectId, { library }, defaults)}
            className="text-micro text-ink-soft hover:text-ink"
          >
            All samples
          </AppLink>
        }
      >
        SAMPLES
      </SectionHead>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <p className="text-micro text-ink-soft tabular-nums">{lede}</p>
        <SamplesLibraryToggle href={toggleHref} pressed={library} />
      </div>
      <PatchbayControls>
        <Patchbay
          layout={layout}
          leftHead="Sets"
          rightHead="Samples"
          summary={lede}
          link={AppLink}
        />
      </PatchbayControls>
    </div>
  );
}
