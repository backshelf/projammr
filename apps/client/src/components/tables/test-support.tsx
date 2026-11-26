import type { DataTableStateValue } from "@/components/tables/data-table-context";
import type {
  DataTableProps,
  EditableCellConfig,
  PageResult,
} from "@/components/tables/generic-table-types";
import { selectOptions } from "@/fields/select-fixture";
import type { FieldConfig } from "@/fields/types";
import type { DeleteKind } from "@/lib/policies/shell";
import { GRID_COMMANDS } from "@/components/commands/grid";
import { CommandRegistry } from "@/components/commands/provider";
import { TABLE_COMMANDS } from "@/components/commands/tables";
import type { ActionContext } from "@/components/commands/types";
import type { TableSearchParams } from "@/lib/table-params";
import type { MemberRole } from "@workspace/api/api";
import { unstubAllGlobals } from "@workspace/test/globals";
import type { RowData } from "@tanstack/react-table";
import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, mock, type Mock } from "bun:test";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useMemo,
} from "react";

// Harness for suites that render the real `DataTable`. `mock.module` is
// process-wide and not hoisted, so the three stubs below are registered before
// the table is first imported; a suite reaches the table only through this
// module and cannot get that order wrong.
//
// The table reaches the router through `use-table-url-state` and the copy
// dialog through its provider. Neither is what these suites are about, so
// each is stubbed the way the rest of the client suites stub them. The
// row cursor's keys run through a real `CommandRegistry`, wrapped around the
// harness below, since that is the surface these suites do test.

/**
 * What the `next/navigation` stub's `useRouter` returns. A suite that needs a
 * different router behaviour configures these mocks; it never calls
 * `mock.module` for `next/navigation` again.
 */
export const routerMock = {
  push: mock(),
  replace: mock(),
  refresh: mock(),
  prefetch: mock(),
};

mock.module("next/navigation", () => ({
  useRouter: mock(() => routerMock),
  usePathname: mock(() => "/project/1/tracks"),
  useSearchParams: mock(() => new URLSearchParams()),
}));

mock.module("@/components/copy-text/CopyTextProvider", () => ({
  useCopyText: mock(() => mock()),
}));

/** A command context stub: the table's commands only read `ctx.surface`,
 *  which the registry attaches per scope push, so nothing else is needed. */
export const STUB_CONTEXT = {} as ActionContext;

// Suites that render the table or its role provider take them from here: an
// import of either from a suite's own header could evaluate before the mocks.
const DataTableModule = await import("./DataTable");
export const { DataTable } = DataTableModule;
const { usePageTableState } = DataTableModule;
export const { ProjectProvider } = await import("@/hooks/use-project-role");
const { useDataTableState } = await import("./data-table-context");
const { createDataTableHelper } =
  await import("@workspace/ui/lib/table-config");

afterEach(() => {
  cleanup();
  unstubAllGlobals();
  for (const fn of Object.values(routerMock)) fn.mockClear();
});

export const mixing: NonNullable<FieldConfig["statuses"]>[number] = {
  id: 2,
  name: "Mixing",
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  percentage: 50,
  description: null,
  projectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export type Row = {
  id: number;
  title: string;
  statusId: number | null;
  genre: string;
  mastered: boolean;
  notes: string;
};

const helper = createDataTableHelper<Row>();
export const columns = helper.columns([
  helper.accessor((row) => row.title, { id: "title", header: "Title" }),
  helper.accessor((row) => row.statusId, { id: "status", header: "Status" }),
  helper.accessor((row) => row.genre, { id: "genre", header: "Genre" }),
  helper.accessor((row) => row.mastered, {
    id: "mastered",
    header: "Mastered",
  }),
  helper.accessor((row) => row.notes, { id: "notes", header: "Notes" }),
]);

export const EDITABLE: Record<string, EditableCellConfig> = {
  title: { type: "text" },
  status: { type: "status", statuses: [mixing] },
  genre: { type: "select", options: selectOptions("Rock", "Pop") },
  mastered: { type: "checkbox" },
};

/**
 * Every column, so `notes` — the one with no `editableCells` entry — is
 * navigable without being editable. Pass it to `renderGrid` for a case that
 * needs a read-only cell inside the grid rather than outside it.
 */
export const NAVIGABLE = ["title", "status", "genre", "mastered", "notes"];

export const DATA: Row[] = [
  {
    id: 10,
    title: "One",
    statusId: 2,
    genre: "Rock",
    mastered: false,
    notes: "first",
  },
  {
    id: 11,
    title: "Two",
    statusId: null,
    genre: "Pop",
    mastered: false,
    notes: "second",
  },
];

/** `count` fixture rows with ids from `from`, alternating Rock and Pop. */
export function rowsOf(count: number, from = 1): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    title: `Track ${from + index}`,
    statusId: null,
    genre: index % 2 === 0 ? "Rock" : "Pop",
    mastered: false,
    notes: "",
  }));
}

/** One call to a `deferredLoad`, settled by the test. */
export type LoadCall = {
  page: number;
  view: TableSearchParams;
  resolve: (result: PageResult<Row>) => void;
  reject: () => void;
};

/**
 * A `serverPage.load` that holds every call until the test settles it, inside
 * `act`, so a suite decides the order responses arrive in.
 */
export function deferredLoad() {
  const calls: LoadCall[] = [];
  const load = mock(
    (page: number, view: TableSearchParams) =>
      new Promise<PageResult<Row>>((resolve, reject) => {
        calls.push({
          page,
          view,
          resolve,
          reject: () => reject(new Error("load failed")),
        });
      })
  );
  const settle = (call: LoadCall | undefined, result?: PageResult<Row>) =>
    act(async () => {
      if (!call) throw new Error("no such load call");
      if (result) call.resolve(result);
      else call.reject();
    });
  return { load, calls, settle };
}

/**
 * A part that reads the root's state half on every commit, for a suite that
 * drives the loaders a later part would call. Render `Probe` as a child of the
 * table; `state()` is what it last committed.
 */
export function stateProbe() {
  const latest: { current: DataTableStateValue<Row> | null } = {
    current: null,
  };
  function Probe() {
    const state = useDataTableState<Row>();
    useLayoutEffect(() => {
      latest.current = state;
    });
    return null;
  }
  const state = () => {
    if (!latest.current) throw new Error("the probe has not rendered");
    return latest.current;
  };
  return { Probe, state };
}

/**
 * The harness's props: the root's, less what the harness supplies, plus its
 * URL switch and anything a suite mounts after the standard parts.
 */
export type TestDataTableProps<TData extends RowData, TChild = never> = Omit<
  DataTableProps<TData, TChild>,
  "children" | "urlState" | "hotkeys" | "deleteKind"
> & {
  persistStateInUrl?: boolean;
  /** Commands registered beside the table's, for a suite pinning precedence over them. */
  extraCommands?: ComponentProps<typeof CommandRegistry>["commands"];
  children?: ReactNode;
  /** The fixture's rows delete as tracks unless a suite says otherwise. */
  deleteKind?: DeleteKind;
};

/**
 * The harness's own composition of `DataTable`: every part in its standard
 * order, configured by props, so a suite renders one table whatever it covers.
 * `persistStateInUrl` (on by default) builds the URL state source and the open
 * peek row's `inUrl` the way a page's own table does; off, the state stays in
 * React and the hotkey scope follows the focus. `children` render after the
 * parts, inside the root, for a suite that reads the root's context.
 */
export function TestDataTable<TData extends RowData, TChild = never>({
  persistStateInUrl = true,
  extraCommands = [],
  children,
  deleteKind = "track",
  ...rest
}: TestDataTableProps<TData, TChild>) {
  const props = { ...rest, deleteKind };
  const parts = (
    <>
      <DataTable.Toolbar<TData, TChild>>
        <DataTable.SavedViews<TData, TChild> />
      </DataTable.Toolbar>

      <DataTable.Cards<TData, TChild> />

      <DataTable.Grid<TData, TChild> />

      <DataTable.Paging />

      <DataTable.Selection />

      <DataTable.Peek<TData, TChild> />

      <DataTable.Move />

      {children}
    </>
  );

  return (
    <CommandRegistry
      commands={[...extraCommands, ...GRID_COMMANDS, ...TABLE_COMMANDS]}
      context={STUB_CONTEXT}
    >
      {persistStateInUrl ? (
        <UrlStateTable<TData, TChild> {...props}>{parts}</UrlStateTable>
      ) : (
        <DataTable<TData, TChild> {...props} hotkeys="focus">
          {parts}
        </DataTable>
      )}
    </CommandRegistry>
  );
}

/** The root as a page's own table, built the way `EntityTable`'s page variant is. */
function UrlStateTable<TData extends RowData, TChild = never>({
  peek,
  ...props
}: Omit<DataTableProps<TData, TChild>, "urlState" | "hotkeys">) {
  const urlState = usePageTableState(props.serverPage);
  const peekInUrl = useMemo(() => peek && { ...peek, inUrl: true }, [peek]);

  return (
    <DataTable<TData, TChild>
      {...props}
      urlState={urlState}
      hotkeys="page"
      peek={peekInUrl}
    />
  );
}

/**
 * Renders the fixture table, inside a `ProjectProvider` when `role` is given.
 * `overrides` replaces any table prop, `data` included. `gridFor` builds the
 * same element for other overrides, to pass to the result's `rerender`.
 */
export function renderGrid(
  role?: MemberRole,
  navigableColumns?: string[],
  overrides: Partial<TestDataTableProps<Row>> = {}
): RenderResult & {
  onCellSave: Mock<() => Promise<boolean>>;
  cell: (key: string) => HTMLElement;
  gridFor: (next?: Partial<TestDataTableProps<Row>>) => ReactElement;
} {
  const onCellSave = mock(async () => true);
  const gridFor = (
    next: Partial<TestDataTableProps<Row>> = {}
  ): ReactElement => {
    const grid = (
      <TestDataTable
        data={DATA}
        columns={columns}
        persistStateInUrl={false}
        editableCells={EDITABLE}
        navigableColumns={navigableColumns}
        onCellSave={onCellSave}
        {...overrides}
        {...next}
      />
    );
    return role === undefined ? (
      grid
    ) : (
      <ProjectProvider project={{ id: 1, name: "Project", role }}>
        {grid}
      </ProjectProvider>
    );
  };
  const result = render(gridFor());
  const cell = (key: string) => {
    const element = result.container.querySelector<HTMLElement>(
      `[data-cell="${key}"]`
    );
    if (!element) throw new Error(`no cell ${key}`);
    return element;
  };
  return { ...result, onCellSave, cell, gridFor };
}

/**
 * One pointer gesture, in the order a browser fires it. A press focuses what it
 * lands on when that can take focus, which is what makes a cell's keys live.
 */
export function press(target: HTMLElement) {
  fireEvent.mouseDown(target);
  act(() => target.focus());
  fireEvent.click(target);
}

/**
 * Fires a real `keydown` on `window`, as a browser does, for one press of a
 * `TABLE_COMMANDS` combo: a bare key (`"j"`, `"Enter"`, `"Home"`) is the
 * event's `key` verbatim, and `mod+` (Ctrl) and `shift+` prefixes set the
 * matching modifier (`"mod+a"`, `"shift+ArrowDown"`). A count or a chord is
 * several calls, one per press.
 * A `hotkeys="focus"` table only pushes the `table` scope while the pointer or
 * focus is inside its grid (`useRowCursor`), so this puts the pointer there
 * first — a no-op for a `hotkeys="page"` table, whose scope is already up.
 *
 * A handful of suites in this directory render several tables across their
 * tests with no `afterEach(cleanup)`, so more than one `[role="grid"]` can be
 * in the document at once; the last one in document order is always the one
 * the calling test just rendered, so that's the one that gets the pointer.
 * `role="grid"` is the `<table>` itself, and `Table`'s own wrapper div sits
 * between it and the div `Grid.tsx` attaches `gridHandlers` to, so the pointer
 * has to clear that wrapper too, not just the table's parent.
 */
export function pressHotkey(combo: string) {
  const grids = document.querySelectorAll('[role="grid"]');
  const gridRoot = grids[grids.length - 1]?.closest(
    '[data-slot="table-container"]'
  )?.parentElement;
  if (gridRoot) fireEvent.pointerEnter(gridRoot);
  const parts = combo.split("+");
  const key = parts.pop() || "+";
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey: parts.includes("mod"),
        shiftKey: parts.includes("shift"),
      })
    );
  });
}
