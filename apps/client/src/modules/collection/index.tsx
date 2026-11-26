import { cachedCollection } from "@/lib/server-data";
import { parseTableQuery } from "@/lib/table-params";
import NewCollection from "@/modules/collection/new";
import CollectionPage from "@/modules/collection/page";
import EntityList from "@/modules/entity-list";
import { routeModule } from "@/modules/route-module";
import { isActionError } from "@workspace/api/lib/action-result";

export const collectionRoutes = {
  collection: routeModule<"collection">({
    loadTitle: async ({ collectionId }) => {
      const collection = await cachedCollection(collectionId);
      return isActionError(collection) ? undefined : collection.title;
    },
    Page: ({ route, searchParams }) => (
      <CollectionPage {...route} query={parseTableQuery(searchParams)} />
    ),
  }),
  "collection-new": routeModule<"collection-new">({
    title: "New collection",
    Page: ({ route }) => <NewCollection {...route} />,
  }),
  "collection-all": routeModule<"collection-all">({
    title: "Collections",
    Page: ({ route, searchParams }) => (
      <EntityList
        kind="collection"
        projectId={route.projectId}
        query={parseTableQuery(searchParams)}
        searchParams={searchParams}
      />
    ),
  }),
};
