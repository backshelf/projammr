import { cachedSession } from "@/lib/server-data";
import { parseTableQuery } from "@/lib/table-params";
import EntityList from "@/modules/entity-list";
import { routeModule, searchParam } from "@/modules/route-module";
import SessionHistoryPage from "@/modules/session/history";
import NewSession from "@/modules/session/new";
import SessionPage from "@/modules/session/page";
import { isActionError } from "@workspace/api/lib/action-result";

export const sessionRoutes = {
  session: routeModule<"session">({
    loadTitle: async ({ sessionId }) => {
      const session = await cachedSession(sessionId);
      return isActionError(session) ? undefined : session.name;
    },
    Page: ({ route }) => <SessionPage {...route} />,
  }),
  "session-new": routeModule<"session-new">({
    title: "New session",
    Page: ({ route, searchParams }) => (
      <NewSession {...route} initialName={searchParam(searchParams.name)} />
    ),
  }),
  "session-all": routeModule<"session-all">({
    title: "Sessions",
    Page: ({ route, searchParams }) => (
      <EntityList
        kind="session"
        projectId={route.projectId}
        query={parseTableQuery(searchParams)}
        searchParams={searchParams}
      />
    ),
  }),
  "session-history": routeModule<"session-history">({
    loadTitle: async ({ sessionId }) => {
      const session = await cachedSession(sessionId);
      return isActionError(session) ? undefined : `${session.name} · History`;
    },
    Page: ({ route, searchParams }) => (
      <SessionHistoryPage {...route} searchParams={searchParams} />
    ),
  }),
};
