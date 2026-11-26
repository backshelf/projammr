import type { InventoryDefaults } from "@/lib/policies/shell";
import { setNodes } from "@/lib/set-nodes";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { SampleUsage, SessionSummary } from "@workspace/api/api";
import type { PatchCable, PatchNode } from "@workspace/ui/lib/patchbay";
import { sampleFileName, sampleFolder } from "@workspace/ui/lib/sample-path";

/** The samples page's tab: every sample, or only those a set cannot find. */
export type SamplesShow = "all" | "missing";

/** What the samples page's URL can say: `?show=`, `?library=1` or `0`,
 *  `?stock=1` or `0`, `?sample=`. A view param left out is the viewer's
 *  default for it. */
export type SamplesPageParams = {
  show?: SamplesShow;
  library?: boolean;
  /** Draws the stock chain in the web. */
  stock?: boolean;
  sample?: string;
};

/** The samples page's view when its URL does not say: the viewer's defaults. */
export type SamplesDefaults = InventoryDefaults["samples"];

/**
 * `/project/:id/samples` with its params, each view param left out when it is
 * the viewer's default (`defaults`), so the plain page has the plain URL.
 * Every link into the page (a tab, the Library toggle, a node, a row, a
 * compact section's "All samples") goes through this.
 */
export function samplesPageHref(
  projectId: number,
  { show, library, stock, sample }: SamplesPageParams,
  defaults: SamplesDefaults
): string {
  const params = new URLSearchParams();
  if (show !== undefined && show !== defaults.show) params.set("show", show);
  if (library !== undefined && library !== defaults.library) {
    params.set("library", library ? "1" : "0");
  }
  if (stock !== undefined && stock !== defaults.stock) {
    params.set("stock", stock ? "1" : "0");
  }
  if (sample !== undefined) params.set("sample", sample);
  const query = params.toString();
  const base = hrefFromParsedRoute({ kind: "samples" }, projectId);
  return query ? `${base}?${query}` : base;
}

export type SamplesGraphOptions = {
  projectId: number;
  show: SamplesShow;
  /** Off hides Core Library, pack and User Library samples everywhere. */
  library: boolean;
  /** Carried on every sample's link, so opening a row keeps the stock chain drawn. */
  stock?: boolean;
  /** The viewer's defaults, which every sample's link is written against. */
  defaults: SamplesDefaults;
  /** Track titles by id, for a set's meta line; a set with no track has none. */
  trackTitles?: ReadonlyMap<number, string>;
};

export type SamplesGraph = {
  /** The samples both filters keep, in the server's order (most shared first): the rows. */
  samples: SampleUsage[];
  /** Sets using a kept sample, in `sessions`' order; ids are session ids as strings. */
  left: PatchNode[];
  /** Every kept sample; ids are its path. `layoutPatchbay` folds single-use ones into "+n own". */
  right: PatchNode[];
  cables: PatchCable[];
  /**
   * The lede's numbers. They follow the Library toggle but not the tab, so
   * switching to Missing does not change the head: samples, the sets using
   * them, those used by more than one set, and those a set cannot find.
   */
  counts: { samples: number; sets: number; shared: number; missing: number };
};

/**
 * Turns the project's sample usage and its session list into what the
 * Patchbay and the rows draw: sets down the left rail (each linking to its
 * session), samples down the right (each linking to its row on the samples
 * page, hollow when missing), one cable per use. A session id the list does
 * not know (deleted between the two reads) is left out with its cables.
 */
export function samplesGraph(
  usage: readonly SampleUsage[],
  sessions: readonly SessionSummary[],
  {
    projectId,
    show,
    library,
    stock,
    defaults,
    trackTitles,
  }: SamplesGraphOptions
): SamplesGraph {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const known = (id: number) => byId.has(id);

  const inLibraryScope = usage.filter(
    (sample) => library || sample.kind !== "library"
  );
  const counted = new Set(
    inLibraryScope.flatMap((sample) => sample.sessionIds.filter(known))
  );
  const counts = {
    samples: inLibraryScope.length,
    sets: counted.size,
    shared: inLibraryScope.filter(
      (sample) => sample.sessionIds.filter(known).length > 1
    ).length,
    missing: inLibraryScope.filter((sample) => sample.missing).length,
  };

  const samples = inLibraryScope.filter(
    (sample) => show === "all" || sample.missing
  );

  const cables: PatchCable[] = [];
  const used = new Set<number>();
  for (const sample of samples) {
    for (const id of sample.sessionIds) {
      if (!known(id)) continue;
      used.add(id);
      cables.push({
        left: String(id),
        right: sample.path,
        missing: sample.missing,
      });
    }
  }

  const left = setNodes(sessions, used, { projectId, trackTitles });

  const right: PatchNode[] = samples.map((sample) => {
    const folder = sampleFolder(sample.path);
    return {
      id: sample.path,
      label: sampleFileName(sample.path),
      ...(folder === "" ? {} : { meta: folder }),
      href: samplesPageHref(
        projectId,
        { show, library, stock, sample: sample.path },
        defaults
      ),
      missing: sample.missing,
    };
  });

  return { samples, left, right, cables, counts };
}
