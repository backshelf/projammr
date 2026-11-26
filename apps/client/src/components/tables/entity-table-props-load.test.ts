import { describe, expect, it, mock } from "bun:test";
import { createDataTableHelper } from "@workspace/ui/lib/table-config";
import type {
  ListCollection,
  ListSession,
  ListTrack,
} from "@workspace/api/api";

import type {
  EntityMutationHandlers,
  EntityTableProps,
} from "@/components/tables/entity-table-props";
import type {
  PageResult,
  SavedViewsConfig,
} from "@/components/tables/generic-table-types";
import type { EntityTableDefinition } from "@/entities/table-types";
import type { EntityModule } from "@/entities/types";
import type { ActionError } from "@workspace/api/api";

/**
 * A 60-row fixture the server would return for a kind past the old default
 * page (25): what `serverPage.load` (`entity-table-props.ts`) should hand
 * back once it is wired to the kind's real `page` call, rather than a stub
 * that throws `serverPage.load is not wired`.
 */
function pageOf<Row>(rows: Row[]) {
  return { rows, rowCount: rows.length, pageSize: rows.length };
}

const trackRows = Array.from(
  { length: 60 },
  (_, i) => ({ id: i, title: `Track ${i}` }) as ListTrack
);
const collectionRows = Array.from(
  { length: 60 },
  (_, i) => ({ id: i, title: `Collection ${i}` }) as ListCollection
);
const sessionRows = Array.from(
  { length: 60 },
  (_, i) => ({ id: i, name: `Session ${i}` }) as ListSession
);

const trackPage = mock((): Promise<PageResult<ListTrack> | ActionError> =>
  Promise.resolve(pageOf(trackRows))
);
const collectionPage = mock(
  (): Promise<PageResult<ListCollection> | ActionError> =>
    Promise.resolve(pageOf(collectionRows))
);
const sessionPage = mock((): Promise<PageResult<ListSession> | ActionError> =>
  Promise.resolve(pageOf(sessionRows))
);

const realApi = await import("@/entities/api");
mock.module("@/entities/api", () => ({
  ...realApi,
  ENTITY_API: {
    track: { page: trackPage },
    collection: { page: collectionPage },
    session: { page: sessionPage },
  },
}));

const { assembleEntityTableProps } =
  await import("@/components/tables/entity-table-props");

/** Only the fields `assembleEntityTableProps` reads off a kind's module. */
function fakeEntity<K extends "track" | "collection" | "session">(
  plural: string
): EntityModule<K> {
  return {
    nouns: { singular: plural.replace(/s$/, ""), plural },
    hasStatus: false,
    labelOf: () => "",
  } as unknown as EntityModule<K>;
}

const mutations: EntityMutationHandlers = {
  onCellSave: async () => true,
  onBulkPatch: async () => ({ ok: true }),
  onBulkDelete: async () => ({ ok: true }),
  onBulkSetLabels: async () => ({ ok: true }),
  onBulkMove: async () => ({ ok: true }),
  onRowDelete: async () => ({ ok: true }),
};

const savedViews: SavedViewsConfig = {
  views: [],
  me: "user-1",
  onSave: async () => true,
  onDelete: async () => true,
  onShare: async () => true,
  defaultViewId: null,
  onSetDefault: async () => true,
  onClearDefault: async () => true,
};

const trackHelper = createDataTableHelper<ListTrack>();
/** A definition's `useParts` is a hook; this fixture's has nothing to hold. */
const partsOfTrack = () => ({ columns: trackHelper.columns([]) });
const trackDefinition: EntityTableDefinition<"track"> = {
  kind: "track",
  identityField: "title",
  href: (row, projectId) => `/project/${projectId}/track/${row.id}`,
  toPeekRow: (row) => ({ id: row.id, title: row.title }),
  pageQuery: (view, scope) => ({
    q: view.q,
    collection: scope?.collectionId,
  }),
  useParts: partsOfTrack,
};

const collectionHelper = createDataTableHelper<ListCollection>();
const partsOfCollection = () => ({ columns: collectionHelper.columns([]) });
const collectionDefinition: EntityTableDefinition<"collection"> = {
  kind: "collection",
  identityField: "title",
  href: (row, projectId) => `/project/${projectId}/collection/${row.id}`,
  toPeekRow: (row) => ({ id: row.id, title: row.title }),
  pageQuery: (view) => ({ q: view.q }),
  useParts: partsOfCollection,
};

const sessionHelper = createDataTableHelper<ListSession>();
const partsOfSession = () => ({ columns: sessionHelper.columns([]) });
const sessionDefinition: EntityTableDefinition<"session"> = {
  kind: "session",
  identityField: "name",
  href: (row, projectId) => `/project/${projectId}/session/${row.id}`,
  toPeekRow: (row) => ({ id: row.id, title: row.name }),
  pageQuery: (view, scope) => ({ q: view.q, track: scope?.trackId }),
  useParts: partsOfSession,
};

describe("assembleEntityTableProps's serverPage.load, wired to the kind's real page call", () => {
  it("loads a track table's 60-row page — tracks on a collection page", async () => {
    const props: EntityTableProps<"track"> = {
      kind: "track",
      rows: [],
      rowCount: 60,
      projectId: 4,
      scope: { collectionId: 7, collections: [] },
    };
    const { serverPage } = assembleEntityTableProps({
      definition: trackDefinition,
      entity: fakeEntity<"track">("tracks"),
      parts: { columns: trackHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 60,
      pinnedIdentityColumn: true,
    });

    const result = await serverPage!.load(1, {});

    expect(result.rows.length).toBeGreaterThan(25);
    expect(result.rows).toHaveLength(60);
    expect(trackPage).toHaveBeenCalledWith(expect.anything(), 4, {
      q: undefined,
      collection: 7,
      page: 1,
      pageSize: 60,
    });
  });

  it("loads later pages at page 1's own size, not a setting changed since", async () => {
    // Page 1 was answered at 50 (a router-cache restore from before the
    // viewer raised rowsPerLoad to 100): page 2 must start at row 50.
    const props: EntityTableProps<"collection"> = {
      kind: "collection",
      rows: [],
      rowCount: 200,
      pageSize: 50,
      projectId: 4,
      scope: {},
    };
    const { serverPage } = assembleEntityTableProps({
      definition: collectionDefinition,
      entity: fakeEntity<"collection">("collections"),
      parts: { columns: collectionHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 100,
      pinnedIdentityColumn: true,
    });

    await serverPage!.load(2, {});

    expect(collectionPage).toHaveBeenCalledWith(expect.anything(), 4, {
      q: undefined,
      page: 2,
      pageSize: 50,
    });
  });

  it("loads a collection table's 60-row page — collections on a project page", async () => {
    const props: EntityTableProps<"collection"> = {
      kind: "collection",
      rows: [],
      rowCount: 60,
      projectId: 4,
      scope: {},
    };
    const { serverPage } = assembleEntityTableProps({
      definition: collectionDefinition,
      entity: fakeEntity<"collection">("collections"),
      parts: { columns: collectionHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 60,
      pinnedIdentityColumn: true,
    });

    const result = await serverPage!.load(1, {});

    expect(result.rows.length).toBeGreaterThan(25);
    expect(collectionPage).toHaveBeenCalledWith(expect.anything(), 4, {
      q: undefined,
      page: 1,
      pageSize: 60,
    });
  });

  it("loads a session table's 60-row page — sessions on a project page", async () => {
    const props: EntityTableProps<"session"> = {
      kind: "session",
      rows: [],
      rowCount: 60,
      projectId: 4,
      scope: { tracks: [], daws: [], machines: [] },
    };
    const { serverPage } = assembleEntityTableProps({
      definition: sessionDefinition,
      entity: fakeEntity<"session">("sessions"),
      parts: { columns: sessionHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 60,
      pinnedIdentityColumn: true,
    });

    const result = await serverPage!.load(1, {});

    expect(result.rows.length).toBeGreaterThan(25);
    expect(sessionPage).toHaveBeenCalledWith(expect.anything(), 4, {
      q: undefined,
      track: undefined,
      page: 1,
      pageSize: 60,
    });
  });

  it("loads a session table's 60-row page scoped to a track — sessions on a track page", async () => {
    const props: EntityTableProps<"session"> = {
      kind: "session",
      rows: [],
      rowCount: 60,
      projectId: 4,
      scope: { trackId: 11, tracks: [], daws: [], machines: [] },
    };
    const { serverPage } = assembleEntityTableProps({
      definition: sessionDefinition,
      entity: fakeEntity<"session">("sessions"),
      parts: { columns: sessionHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 60,
      pinnedIdentityColumn: true,
    });

    const result = await serverPage!.load(1, {});

    expect(result.rows.length).toBeGreaterThan(25);
    expect(sessionPage).toHaveBeenCalledWith(expect.anything(), 4, {
      q: undefined,
      track: 11,
      page: 1,
      pageSize: 60,
    });
  });

  it("throws the server's message when the page read fails", async () => {
    trackPage.mockImplementationOnce(() =>
      Promise.resolve({ error: "Failed to fetch tracks" })
    );
    const props: EntityTableProps<"track"> = {
      kind: "track",
      rows: [],
      rowCount: 60,
      projectId: 4,
      scope: { collectionId: 7, collections: [] },
    };
    const { serverPage } = assembleEntityTableProps({
      definition: trackDefinition,
      entity: fakeEntity<"track">("tracks"),
      parts: { columns: trackHelper.columns([]) },
      mutations,
      savedViews,
      props,
      rowsPerLoad: 60,
      pinnedIdentityColumn: true,
    });

    await expect(serverPage!.load(1, {})).rejects.toThrow(
      "Failed to fetch tracks"
    );
  });
});
