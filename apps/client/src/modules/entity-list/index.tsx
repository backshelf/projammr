import { getLabels } from "@/actions/labels";
import { getPriorityLevels } from "@/actions/priorities";
import { getRelationTypes } from "@/actions/relation-types";
import { getSavedViews } from "@/actions/saved-views";
import { getStatuses } from "@/actions/statuses";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { AppLink } from "@/components/navigation/AppLink";
import { EntityBoard } from "@/components/tables/EntityBoard";
import { EntityTable } from "@/components/tables/EntityTable";
import type { EntityTableProps } from "@/components/tables/entity-table-props";
import { TableSkeleton } from "@/components/tables/TableSkeleton";
import { ViewSwitcher } from "@/components/tables/ViewSwitcher";
import {
  defaultViewQuery,
  hasViewParams,
  unshowableBoardQuery,
} from "@/lib/default-view";
import { entityModule } from "@/entities";
import type { EntityModule } from "@/entities/types";
import { loaded } from "@/lib/loaded";
import { PEEK_PARAM } from "@/lib/peek-param";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { cachedCustomFields, cachedMe, cachedProject } from "@/lib/server-data";
import {
  serializeVisibility,
  TABLE_PARAM,
  type TableSearchParams,
} from "@/lib/table-params";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { listBody, type ListScope } from "@/modules/entity-list/body";
import { archivedListCopy, listCopy } from "@/modules/entity-list/copy";
import {
  ENTITY_LISTS,
  type EntityListConfig,
  type PageLoader,
} from "@/modules/entity-list/lists";
import type { RouteSearchParams } from "@/modules/route-module";
import { IconPlus } from "@tabler/icons-react";
import type { TableEntityKind, TracksPageQuery } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import type { SettingsValues } from "@workspace/settings";
import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { PAGE_WIDE } from "@workspace/ui/lib/shell";
import { redirect } from "next/navigation";
import { Suspense } from "react";

/**
 * A kind's index page: head, lede, "New" button and table. A kind with a
 * status also gets the view switcher and a board in place of the table. What
 * differs between kinds is the entity module (nouns, routes, status) and the
 * kind's `ENTITY_LISTS` config (the page loader, the lede, the table's lookups).
 * The archived scope lists an archivable kind's archived rows instead: a table
 * only, with no switcher or "New" button, and an empty state when the kind has
 * nothing archived.
 */
export default async function EntityList<K extends TableEntityKind>({
  kind,
  projectId,
  query = {},
  scope = "live",
  searchParams = {},
}: {
  kind: K;
  projectId: number;
  query?: TableSearchParams;
  /** Which of the kind's rows the page lists: its live rows by default, or its
   *  archived ones (tracks only). */
  scope?: ListScope;
  /** The route's raw search params, for the bare-URL redirect below —
   *  `query` alone has already lost `cols`/`order`/`w`. */
  searchParams?: RouteSearchParams;
}) {
  const config = ENTITY_LISTS[kind];
  const entity = entityModule(kind);
  const showsBoard = entity.hasStatus && scope !== "archived";

  const listQuery = unshowableBoardQuery(searchParams, showsBoard);
  const path = listPath(entity, config, projectId, scope);
  if (listQuery !== undefined && path) redirect(`${path}?${listQuery}`);

  if (!hasViewParams(searchParams)) {
    const peek = searchParams[PEEK_PARAM];
    const target = await defaultViewTarget(
      kind,
      entity,
      config,
      projectId,
      scope,
      typeof peek === "string" ? peek : undefined
    );
    if (target) redirect(target);
  }

  const projectResult = await cachedProject(projectId);
  const project = loaded(projectResult);

  // The head paints as soon as the project resolves; the table's own fetches
  // stream in behind the boundary below.
  const archived = scope === "archived" ? ("only" as const) : undefined;
  const rowsPerLoad = (await cachedEffectiveSettings(projectId)).values[
    "tables.rowsPerLoad"
  ];
  const pagePromise = config.loadPage(projectId, query, archived, rowsPerLoad);
  const archivedCountPromise = archived
    ? config.archived?.count(projectId)
    : undefined;
  const copy = listCopy(entity, config, project.name);
  const archivedCopy = archivedListCopy(entity);
  const headCopy = archived ? archivedCopy : copy;
  const crumbs = createBreadcrumbs(project);
  if (entity.listRoute) {
    crumbs.push({
      label: copy.crumb,
      href: hrefFromParsedRoute(entity.listRoute, projectId),
    });
  }
  if (archived && config.archived) {
    crumbs.push({
      label: archivedCopy.crumb,
      href: hrefFromParsedRoute(config.archived.route, projectId),
    });
  }
  const newHref = entity.newRoute
    ? hrefFromParsedRoute(entity.newRoute, projectId)
    : undefined;
  const view = showsBoard && query.view === "board" ? "board" : "list";
  const newButton = newHref && (
    <Button size="lg" asChild>
      <AppLink href={newHref}>
        <IconPlus />
        {copy.newLabel}
      </AppLink>
    </Button>
  );
  // The live page of an archivable kind points at its archived rows; the
  // count streams in on its own, so it never holds the head back.
  const archivedLink = !archived && config.archived && (
    <Suspense fallback={null}>
      <ArchivedLink archived={config.archived} projectId={projectId} />
    </Suspense>
  );

  return (
    <ScrollRoot className={PAGE_WIDE}>
      <PageHead
        crumbs={<Breadcrumbs crumbs={crumbs} />}
        title={headCopy.title}
        lede={
          <Suspense fallback={headCopy.lede}>
            <EntityListLede
              kind={kind}
              config={config}
              scope={scope}
              projectName={project.name}
              pagePromise={pagePromise}
            />
          </Suspense>
        }
        action={
          archived ? undefined : entity.hasStatus || archivedLink ? (
            <div className="flex items-center gap-2">
              {archivedLink}
              {entity.hasStatus && <ViewSwitcher current={view} />}
              {newButton}
            </div>
          ) : (
            newButton
          )
        }
      />
      <Suspense fallback={<TableSkeleton />}>
        <EntityListBody
          kind={kind}
          config={config}
          scope={scope}
          view={view}
          projectId={projectId}
          query={query}
          pagePromise={pagePromise}
          archivedCountPromise={archivedCountPromise}
          empty={archivedCopy.empty}
        />
      </Suspense>
    </ScrollRoot>
  );
}

/**
 * The redirect target for a bare list URL: a default saved view's query when
 * one is set for `(projectId, kind)` and the view still exists, else the
 * kind's own columns/sort/grouping settings; `view=` is always added.
 * `undefined` when the kind has no route to redirect to for this scope
 * (never true for the live scope; the archived scope only ever reaches this
 * for track, the only archivable kind). On the live scope, the tracks
 * table's default archived visibility rides along too — the archived scope
 * itself is fixed by the route, not by a setting, so it never does.
 */
/** The list page a scope lives at, or `undefined` for a kind without one. */
function listPath<K extends TableEntityKind>(
  entity: EntityModule<K>,
  config: EntityListConfig<K>,
  projectId: number,
  scope: ListScope
): string | undefined {
  const route =
    scope === "archived" ? config.archived?.route : entity.listRoute;
  return route ? hrefFromParsedRoute(route, projectId) : undefined;
}

export async function defaultViewTarget<K extends TableEntityKind>(
  kind: K,
  entity: EntityModule<K>,
  config: EntityListConfig<K>,
  projectId: number,
  scope: ListScope,
  /** The bare URL's `peek`, carried into the target so the open row stays open. */
  peek?: string
): Promise<string | undefined> {
  const path = listPath(entity, config, projectId, scope);
  if (!path) return undefined;

  const values = (await cachedEffectiveSettings(projectId)).values;
  const defaultViewId =
    values["tables.defaultSavedView"][String(projectId)]?.[kind];
  const savedView =
    defaultViewId != null
      ? await defaultSavedViewOf(projectId, kind, defaultViewId)
      : undefined;

  const { query, view } = savedView
    ? { query: savedView.config.query, view: "list" as const }
    : perKindDefaultQuery(kind, values);
  // The archived scope only ever renders a table (`body.ts`'s `listBody`
  // ignores `view` there), so a board default must never reach its URL —
  // that view mode would be permanently unreachable and unfixable by any
  // in-app action.
  const resolvedView = scope === "archived" ? "list" : view;

  const params = new URLSearchParams(defaultViewQuery(query, resolvedView));
  if (scope === "live" && values["tables.archived"] !== "hide") {
    params.set(TABLE_PARAM.archived, values["tables.archived"]);
  }
  if (peek) params.set(PEEK_PARAM, peek);
  return `${path}?${params.toString()}`;
}

/** The default saved view a `tables.defaultSavedView` id names, or
 *  `undefined` when the read fails or the view no longer exists — callers
 *  fall back to the per-kind settings either way. */
async function defaultSavedViewOf(
  projectId: number,
  kind: TableEntityKind,
  id: number
) {
  const result = await getSavedViews(projectId, kind);
  return isActionError(result) ? undefined : result.find((v) => v.id === id);
}

/** One kind's default query, from its own columns/sort/grouping settings,
 *  spelled exactly as the URL does: `serializeVisibility`'s `cols=`, the
 *  sort setting's own `id.asc`/`id.desc` string and the grouping setting's
 *  own column id, unchanged. Sessions have no board, so their view is
 *  always list. */
function perKindDefaultQuery(
  kind: TableEntityKind,
  values: SettingsValues
): { query: string; view: "list" | "board" } {
  const params = new URLSearchParams();
  const build = (
    columns: Record<string, boolean>,
    sort: string,
    grouping: string
  ) => {
    const visibility = serializeVisibility(columns);
    if (visibility) params.set(TABLE_PARAM.visibility, visibility);
    if (sort) params.set(TABLE_PARAM.sort, sort);
    if (grouping) params.set(TABLE_PARAM.grouping, grouping);
    return params.toString();
  };
  switch (kind) {
    case "track":
      return {
        query: build(
          values["tables.trackColumns"],
          values["tables.trackSort"],
          values["tables.trackGrouping"]
        ),
        view: values["tables.trackView"],
      };
    case "collection":
      return {
        query: build(
          values["tables.collectionColumns"],
          values["tables.collectionSort"],
          values["tables.collectionGrouping"]
        ),
        view: values["tables.collectionView"],
      };
    case "session":
      return {
        query: build(
          values["tables.sessionColumns"],
          values["tables.sessionSort"],
          values["tables.sessionGrouping"]
        ),
        view: "list",
      };
  }
}

/** The quiet "{N} archived" link to a kind's archived page; nothing while
 *  none are archived. */
async function ArchivedLink({
  archived,
  projectId,
}: {
  archived: NonNullable<EntityListConfig<TableEntityKind>["archived"]>;
  projectId: number;
}) {
  const count = await archived.count(projectId);
  if (count === 0) return null;

  return (
    <AppLink
      href={hrefFromParsedRoute(archived.route, projectId)}
      className="text-small text-ink-soft transition-colors hover:text-ink"
    >
      {count} archived
    </AppLink>
  );
}

async function EntityListLede<K extends TableEntityKind>({
  kind,
  config,
  scope,
  projectName,
  pagePromise,
}: {
  kind: K;
  config: EntityListConfig<K>;
  scope: ListScope;
  projectName: string;
  pagePromise: ReturnType<PageLoader[K]>;
}) {
  const page = await pagePromise;
  const count = isActionError(page) ? undefined : page.rowCount;
  const entity = entityModule(kind);
  return scope === "archived"
    ? archivedListCopy(entity, count).lede
    : listCopy(entity, config, projectName, count).lede;
}

/** The table, the board or the empty state, as {@link listBody} decides once
 *  the archived count (on an archived page) is in. */
async function EntityListBody<K extends TableEntityKind>({
  kind,
  config,
  scope,
  view,
  projectId,
  query,
  pagePromise,
  archivedCountPromise,
  empty,
}: {
  kind: K;
  config: EntityListConfig<K>;
  scope: ListScope;
  view: "list" | "board";
  projectId: number;
  query: TableSearchParams;
  pagePromise: ReturnType<PageLoader[K]>;
  archivedCountPromise: Promise<number> | undefined;
  empty: string;
}) {
  const body = listBody({
    scope,
    view,
    archivedCount: await archivedCountPromise,
  });
  if (body === "empty") {
    return (
      <Arrive>
        <Empty className="border-0 py-10">
          <EmptyHeader>
            <EmptyTitle>{empty}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </Arrive>
    );
  }
  if (body === "board") {
    return <EntityListBoard kind={kind} projectId={projectId} query={query} />;
  }
  return (
    <EntityListTable
      kind={kind}
      config={config}
      archived={scope === "archived" ? "only" : query.archived}
      projectId={projectId}
      pagePromise={pagePromise}
    />
  );
}

/** Every filter the query carries goes down: the kind's board definition picks
 *  out the keys it reads. */
async function EntityListBoard<K extends TableEntityKind>({
  kind,
  projectId,
  query,
}: {
  kind: K;
  projectId: number;
  query: TableSearchParams;
}) {
  const statuses = loaded(await getStatuses(projectId));
  return (
    <Arrive>
      <EntityBoard
        kind={kind}
        projectId={projectId}
        statuses={statuses}
        filters={query}
      />
    </Arrive>
  );
}

async function EntityListTable<K extends TableEntityKind>({
  kind,
  config,
  archived,
  projectId,
  pagePromise,
}: {
  kind: K;
  config: EntityListConfig<K>;
  /** The archived scope the page is in, which the table's later pages keep. */
  archived: TracksPageQuery["archived"];
  projectId: number;
  pagePromise: ReturnType<PageLoader[K]>;
}) {
  const [
    page,
    labelsResult,
    savedViewsResult,
    scope,
    statusesResult,
    levelsResult,
    relationTypesResult,
    customFields,
    meResult,
  ] = await Promise.all([
    pagePromise,
    getLabels(projectId),
    getSavedViews(projectId, kind),
    config.loadScope(projectId),
    entityModule(kind).hasStatus ? getStatuses(projectId) : undefined,
    getPriorityLevels(projectId),
    kind === "track" ? getRelationTypes(projectId) : undefined,
    cachedCustomFields(projectId, entityModule(kind).customFieldKind),
    cachedMe(),
  ]);

  // The three kinds' pages share these five fields, but `K` is open here, so
  // the compiler cannot pick the union member `PageLoader[K]` resolves to.
  const { rows, rowCount, pageSize, facets, groups } = loaded(page) as Pick<
    EntityTableProps<K>,
    "rows" | "rowCount" | "pageSize" | "facets" | "groups"
  >;

  return (
    <Arrive>
      <EntityTable
        kind={kind}
        rows={rows}
        rowCount={rowCount}
        pageSize={pageSize}
        facets={facets}
        groups={groups}
        projectId={projectId}
        projectLabels={isActionError(labelsResult) ? [] : labelsResult}
        priorityLevels={isActionError(levelsResult) ? [] : levelsResult}
        customFields={customFields}
        savedViews={
          isActionError(savedViewsResult) ? undefined : savedViewsResult
        }
        me={isActionError(meResult) ? "" : meResult.id}
        statuses={
          statusesResult === undefined || isActionError(statusesResult)
            ? undefined
            : statusesResult
        }
        relationTypes={
          relationTypesResult === undefined ||
          isActionError(relationTypesResult)
            ? undefined
            : relationTypesResult
        }
        scope={archived ? { ...scope, archived } : scope}
      />
    </Arrive>
  );
}
