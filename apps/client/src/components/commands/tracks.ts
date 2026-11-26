import { defineCommands, GLOBAL } from "@/components/commands/define";
import type { ActionContext, RouteTrack } from "@/components/commands/types";
import { trackToPlayable } from "@/components/music-player/play-track";
import { archiveTracks, unarchiveTracks } from "@/entities/track/archive";
import { toastActionResult } from "@/lib/action-toast";
import type { ParsedRoute } from "@/lib/route-parser";
import {
  IconArchive,
  IconArchiveOff,
  IconPlayerPlay,
} from "@tabler/icons-react";

/**
 * The route's track, looked up in the project's track summaries. A track the
 * summaries do not have yet (one just created) is taken to be live.
 */
export function routeTrackFrom(
  route: ParsedRoute,
  tracks: readonly { id: number; title: string; archived: boolean }[]
): RouteTrack | null {
  if (route.kind !== "track") return null;
  return (
    tracks.find((track) => track.id === route.trackId) ?? {
      id: route.trackId,
      archived: false,
    }
  );
}

/** Archives or unarchives the route's track and toasts the result, with its Undo. */
function setRouteTrackArchived(archived: boolean) {
  return async (ctx: ActionContext) => {
    if (ctx.projectId === null || ctx.routeTrack === null) return;
    const change = archived ? archiveTracks : unarchiveTracks;
    toastActionResult(
      await change({
        projectId: ctx.projectId,
        selection: { ids: [ctx.routeTrack.id] },
        title: ctx.routeTrack.title,
        router: ctx.router,
      }),
      ctx.undoWindowMs
    );
  };
}

/** Plays the route's track now; does nothing off a track page. */
export async function playRouteTrack(ctx: ActionContext) {
  if (ctx.route.kind !== "track") return;
  const items = await trackToPlayable(ctx.route.trackId, ctx.playback);
  if (items && items.length > 0) ctx.playerActions.playNow(items);
}

/** What a track page's own track can have done to it. */
export const TRACK_COMMANDS = defineCommands(GLOBAL, [
  {
    id: "play-this-track",
    label: "Play this track",
    group: "Track",
    when: (ctx) => ctx.route.kind === "track",
    run: playRouteTrack,
    palette: { icon: IconPlayerPlay },
  },
  {
    id: "archive-track",
    label: "Archive track",
    group: "Track",
    keys: ["e"],
    when: (ctx) =>
      ctx.canEdit && ctx.routeTrack !== null && !ctx.routeTrack.archived,
    run: setRouteTrackArchived(true),
    palette: { icon: IconArchive },
  },
  {
    id: "unarchive-track",
    label: "Unarchive track",
    group: "Track",
    when: (ctx) =>
      ctx.canEdit && ctx.routeTrack !== null && ctx.routeTrack.archived,
    run: setRouteTrackArchived(false),
    palette: { icon: IconArchiveOff },
  },
]);
