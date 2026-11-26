import { diffSaves } from "@workspace/session-diff";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { SaveTimelineEntry } from "@workspace/ui/components/session-structure/save-timeline";
import type { ProjectSave } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";

export type SaveEntry = SaveTimelineEntry & { href: string };

/** A project's saves as timeline entries, each linking to its session and
 *  its chips worded in the viewer's `format`. */
export function saveEntries(
  saves: ProjectSave[],
  projectId: number,
  format: Formatters
): SaveEntry[] {
  return saves.map((save) => ({
    id: save.id,
    fileUpdatedAt: save.fileUpdatedAt,
    machineName: save.machineName,
    source: save.source,
    title: save.session.name,
    chips: save.meta
      ? diffSaves(save.previousMeta, save.meta, undefined, format)
      : [],
    href: hrefFromParsedRoute(
      {
        kind: "session",
        sessionId: save.session.id,
        trackId: save.session.trackId ?? undefined,
      },
      projectId
    ),
  }));
}
