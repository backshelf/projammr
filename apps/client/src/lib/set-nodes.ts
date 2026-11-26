import { hrefFromParsedRoute } from "@/lib/utils";
import type { SessionSummary } from "@workspace/api/api";
import type { PatchNode } from "@workspace/ui/lib/patchbay";

/**
 * The left rail every inventory graph shares: the sessions `used` names, in
 * list order, each labelled by its name, carrying its track's title as meta
 * when `trackTitles` knows it, and linking to its session page.
 */
export function setNodes(
  sessions: readonly SessionSummary[],
  used: ReadonlySet<number>,
  {
    projectId,
    trackTitles,
  }: { projectId: number; trackTitles?: ReadonlyMap<number, string> }
): PatchNode[] {
  return sessions
    .filter((session) => used.has(session.id))
    .map((session) => {
      const meta =
        session.trackId === null
          ? undefined
          : trackTitles?.get(session.trackId);
      return {
        id: String(session.id),
        label: session.name,
        ...(meta === undefined ? {} : { meta }),
        href: hrefFromParsedRoute(
          {
            kind: "session",
            sessionId: session.id,
            ...(session.trackId === null ? {} : { trackId: session.trackId }),
          },
          projectId
        ),
      };
    });
}
