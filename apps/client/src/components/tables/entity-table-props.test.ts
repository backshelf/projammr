import {
  assembleEntityTableProps,
  type EntityMutationHandlers,
  type EntityTableProps,
} from "@/components/tables/entity-table-props";
import type {
  EditableCellConfig,
  SavedViewsConfig,
} from "@/components/tables/generic-table-types";
import { entityModule } from "@/entities";
import type {
  EntityTableChild,
  EntityTableDefinition,
  EntityTableParts,
} from "@/entities/table-types";
import type {
  Facets,
  Label,
  ListSession,
  ListTrack,
  Status,
} from "@workspace/api/api";
import { createDataTableHelper } from "@workspace/ui/lib/table-config";
import { describe, expect, it } from "bun:test";

const trackHelper = createDataTableHelper<ListTrack>();
const trackColumns = trackHelper.columns([
  trackHelper.accessor((row) => row.title, { id: "title", header: "Title" }),
  trackHelper.accessor((row) => row.priority, {
    id: "priority",
    header: "Priority",
  }),
  trackHelper.accessor((row) => row.isrc, { id: "isrc", header: "ISRC" }),
]);

const editableCells: Record<string, EditableCellConfig> = {
  priority: { type: "priority" },
};

/** Only the fields the assembled props read off a row. */
const trackRow = (id: number, title: string) => ({ id, title }) as ListTrack;

const trackParts: EntityTableParts<ListTrack, EntityTableChild["track"]> = {
  columns: trackColumns,
  editableCells,
  newRow: { fields: {}, onCreate: async () => true },
  filterColumns: [
    { id: "status", label: "Status", param: "status", options: [] },
  ],
  groupByOptions: [{ id: "status", label: "Status" }],
  getRowGroupKey: (_row, groupKey) => groupKey,
  subRows: { getRows: () => undefined, cells: {} },
  cards: { keyFields: ["artists"] },
  initiallyHiddenColumns: ["isrc"],
  rowAccent: { accentHex: () => null },
  bulkCollections: [{ id: 3, title: "EP" }],
  onBulkAddToCollection: async () => ({ ok: true }),
  mutationOptions: { saveField: async () => undefined },
};

/** A definition's `useParts` is a hook; a fixture's has nothing to hold. */
const partsOfTrack = () => trackParts;

const trackDefinition: EntityTableDefinition<"track"> = {
  kind: "track",
  identityField: "title",
  href: (row, projectId, scope) =>
    scope?.collectionId != null
      ? `/project/${projectId}/collection/${scope.collectionId}/track/${row.id}`
      : `/project/${projectId}/track/${row.id}`,
  toPeekRow: (row) => ({ id: row.id, title: row.title, subtitle: "peeked" }),
  pageQuery: (view, scope) => ({ q: view.q, collection: scope?.collectionId }),
  useParts: partsOfTrack,
};

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

const statuses = [{ id: 1, name: "Demo" }] as Status[];
const facets: Facets = { status: { "1": 3 } };
const projectLabels = [{ id: 1, name: "Demo" }] as Label[];

const trackProps: EntityTableProps<"track"> = {
  kind: "track",
  rows: [trackRow(11, "Kick")],
  rowCount: 42,
  facets,
  groups: [{ key: "1", label: "Demo", count: 2 }],
  projectId: 4,
  statuses,
  projectLabels,
  scope: { collectionId: 7, collections: [] },
};

function assembleTrack(
  overrides: Partial<EntityTableProps<"track">> = {},
  settings: { rowsPerLoad?: number; pinnedIdentityColumn?: boolean } = {}
) {
  return assembleEntityTableProps({
    definition: trackDefinition,
    entity: entityModule("track"),
    parts: trackParts,
    mutations,
    savedViews,
    props: { ...trackProps, ...overrides },
    rowsPerLoad: settings.rowsPerLoad ?? 50,
    pinnedIdentityColumn: settings.pinnedIdentityColumn ?? true,
  });
}

describe("assembleEntityTableProps", () => {
  it("names the table from the kind's own nouns", () => {
    const props = assembleTrack();

    expect(props.entityLabel).toBe("track");
    expect(props.emptyText).toBe("No tracks yet");
  });

  it("pins and titles the peek panel by the identity field", () => {
    const props = assembleTrack();

    expect(props.pinnedColumnId).toBe("title");
    expect(props.peek?.titleField).toBe("title");
  });

  it("unpins the identity column when tables.pinnedIdentityColumn is off", () => {
    const props = assembleTrack({}, { pinnedIdentityColumn: false });

    expect(props.pinnedColumnId).toBeUndefined();
    // The peek panel still titles by the identity field either way.
    expect(props.peek?.titleField).toBe("title");
  });

  it("navigates the identity column and every editable one", () => {
    expect(assembleTrack().navigableColumns).toEqual(["title", "priority"]);
  });

  it("lets a kind name its own navigable columns instead", () => {
    const props = assembleEntityTableProps({
      definition: trackDefinition,
      entity: entityModule("track"),
      parts: { ...trackParts, navigableColumns: ["isrc"] },
      mutations,
      savedViews,
      props: trackProps,
      rowsPerLoad: 50,
      pinnedIdentityColumn: true,
    });

    expect(props.navigableColumns).toEqual(["isrc"]);
  });

  it("peeks and links a row under the scope it was listed in", () => {
    const props = assembleTrack();
    const row = trackRow(11, "Kick");

    expect(props.peek?.toPeekRow(row)).toEqual({
      id: 11,
      title: "Kick",
      subtitle: "peeked",
    });
    expect(props.peek?.href(row)).toBe("/project/4/collection/7/track/11");
    expect(props.rowActions?.copyHref?.(row)).toBe(
      "/project/4/collection/7/track/11"
    );
  });

  it("labels a row for its confirmation through the entity module", () => {
    expect(assembleTrack().rowActions?.label?.(trackRow(11, "Kick"))).toBe(
      "Kick"
    );
  });

  it("wires track playback with the active collection scope into rowActions", () => {
    const props = assembleTrack();
    expect(props.rowActions?.play?.(trackRow(11, "Kick"))).toEqual({
      kind: "track",
      id: 11,
      title: "Kick",
      collectionId: 7,
    });
  });

  it("moves a row to a route in the destination that names the row alone", () => {
    const moveToProject = assembleTrack().moveToProject;

    expect(moveToProject?.kind).toBe("track");
    expect(moveToProject?.projectId).toBe(4);
    expect(moveToProject?.hrefInProject(trackRow(11, "Kick"), 9)).toBe(
      "/project/9/track/11"
    );
  });

  it("wires editing and the bulk bar to the mutation handlers", () => {
    const props = assembleTrack();

    expect(props.onCellSave).toBe(mutations.onCellSave);
    expect(props.onBulkPatch).toBe(mutations.onBulkPatch);
    expect(props.onBulkDelete).toBe(mutations.onBulkDelete);
    expect(props.onBulkSetLabels).toBe(mutations.onBulkSetLabels);
    expect(props.onBulkMove).toBe(mutations.onBulkMove);
    expect(props.rowActions?.onDelete).toBe(mutations.onRowDelete);
  });

  it("offers the bulk bar the project's labels for a page table and an embedded one", () => {
    expect(assembleTrack().bulkLabels).toBe(projectLabels);
    expect(assembleTrack({ embedded: true }).bulkLabels).toBe(projectLabels);
  });

  it("carries the page, its facets and its groups through", () => {
    const props = assembleTrack();

    expect(props.data).toBe(trackProps.rows);
    expect(props.facets).toBe(facets);
    expect(props.serverGroups).toBe(trackProps.groups);
    expect(props.enableSelection).toBe(true);
  });

  it("defers paging to the server only when a row count is given", () => {
    expect(assembleTrack().serverPage).toEqual({
      rowCount: 42,
      load: expect.any(Function),
      scopeParams: { collection: "7" },
    });
    expect(assembleTrack({ rowCount: undefined }).serverPage).toBeUndefined();
  });

  it("leaves selecting every matching row on (does not opt out)", () => {
    expect(assembleTrack().serverPage?.selectAllMatching).toBeUndefined();
  });

  it("pins what the scope fixes, and nothing else, onto a select-all selection", () => {
    expect(assembleTrack().serverPage?.scopeParams).toEqual({
      collection: "7",
    });
    expect(
      assembleTrack({ scope: { collections: [] } }).serverPage?.scopeParams
    ).toEqual({});
  });

  it("mirrors a page table's open row into the URL and offers its saved views", () => {
    const props = assembleTrack();

    expect(props.peek?.inUrl).toBe(true);
    expect(props.savedViews).toBe(savedViews);
  });

  it("keeps an embedded table's open row and views off the page it sits on", () => {
    const props = assembleTrack({ embedded: true });

    expect(props.peek?.inUrl).toBe(false);
    expect(props.savedViews).toBeUndefined();
  });

  it("loads an embedded table's further pages the same as a page table's", () => {
    const props = assembleTrack({ embedded: true });

    expect(props.serverPage).toEqual({
      rowCount: 42,
      load: expect.any(Function),
      scopeParams: { collection: "7" },
    });
  });

  it("offers the bulk bar the statuses of a kind that has them", () => {
    expect(assembleTrack().bulkStatuses).toBe(statuses);
  });

  it("forwards every part a kind supplies and keeps its mutation options", () => {
    const props = assembleTrack();
    const supplied = Object.entries(trackParts).filter(
      ([key]) => key !== "mutationOptions"
    );

    expect(supplied.length).toBe(Object.keys(trackParts).length - 1);
    for (const [key, value] of supplied) {
      expect((props as unknown as Record<string, unknown>)[key]).toBe(value);
    }
    expect("mutationOptions" in props).toBe(false);
  });
});

describe("assembleEntityTableProps for a kind with no status", () => {
  const sessionHelper = createDataTableHelper<ListSession>();
  const sessionColumns = sessionHelper.columns([
    sessionHelper.accessor((row) => row.name, { id: "name", header: "Name" }),
  ]);

  const sessionParts: EntityTableParts<ListSession, never> = {
    columns: sessionColumns,
    editableCells: {},
  };

  const partsOfSession = () => sessionParts;

  const sessionDefinition: EntityTableDefinition<"session"> = {
    kind: "session",
    identityField: "name",
    href: (row, projectId) => `/project/${projectId}/session/${row.id}`,
    toPeekRow: (row) => ({ id: row.id, title: row.name }),
    pageQuery: (view) => ({ q: view.q }),
    useParts: partsOfSession,
  };

  const assembleSession = () =>
    assembleEntityTableProps({
      definition: sessionDefinition,
      entity: entityModule("session"),
      parts: sessionParts,
      mutations,
      savedViews,
      props: {
        kind: "session",
        rows: [],
        rowCount: 3,
        projectId: 4,
        statuses,
        scope: { tracks: [], daws: [], machines: [] },
      },
      rowsPerLoad: 50,
      pinnedIdentityColumn: true,
    });

  it("withholds the bulk bar's statuses and playback row actions", () => {
    const props = assembleSession();
    expect(props.bulkStatuses).toBeUndefined();
    expect(props.rowActions?.play).toBeUndefined();
  });

  it("still names, pins and peeks by its own identity field", () => {
    const props = assembleSession();

    expect(props.entityLabel).toBe("session");
    expect(props.emptyText).toBe("No sessions yet");
    expect(props.pinnedColumnId).toBe("name");
    expect(props.peek?.titleField).toBe("name");
    expect(props.navigableColumns).toEqual(["name"]);
  });
});
