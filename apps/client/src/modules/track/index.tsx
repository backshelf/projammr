import { cachedTrack } from "@/lib/server-data";
import { parseTableQuery } from "@/lib/table-params";
import EntityList from "@/modules/entity-list";
import { routeModule, searchParam } from "@/modules/route-module";
import NewTrack from "@/modules/track/new";
import TrackPage from "@/modules/track/page";
import { isActionError } from "@workspace/api/lib/action-result";

export const trackRoutes = {
  track: routeModule<"track">({
    loadTitle: async ({ trackId }) => {
      const track = await cachedTrack(trackId);
      return isActionError(track) ? undefined : track.title;
    },
    Page: ({ route }) => <TrackPage {...route} />,
  }),
  "track-new": routeModule<"track-new">({
    title: "New track",
    Page: ({ route, searchParams }) => (
      <NewTrack {...route} initialTitle={searchParam(searchParams.title)} />
    ),
  }),
  "track-all": routeModule<"track-all">({
    title: "Tracks",
    Page: ({ route, searchParams }) => (
      <EntityList
        kind="track"
        projectId={route.projectId}
        query={parseTableQuery(searchParams)}
        searchParams={searchParams}
      />
    ),
  }),
  "track-archived": routeModule<"track-archived">({
    title: "Archived tracks",
    Page: ({ route, searchParams }) => (
      <EntityList
        kind="track"
        scope="archived"
        projectId={route.projectId}
        query={parseTableQuery(searchParams)}
        searchParams={searchParams}
      />
    ),
  }),
};
