import {
  CommandRegistry,
  useKeymapState,
} from "@/components/commands/provider";
import { TABLE_COMMANDS } from "@/components/commands/tables";
import type { ActionContext } from "@/components/commands/types";
import type { DataTableProps } from "@/components/tables/DataTable";
import type { TableAction } from "@/components/tables/generic-table-types";
import type { Row } from "@/components/tables/test-support";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { useLayoutEffect } from "react";

const { DATA, columns } = await import("@/components/tables/test-support");
const { DataTable } = await import("@/components/tables/DataTable");
const { useTableUrlState } =
  await import("@/components/tables/use-table-url-state");
const { useDataTable } = await import("@/components/tables/data-table-context");
const { ProjectProvider } = await import("@/hooks/use-project-role");
const { idColumn } = await import("@/components/tables/columns");
const { createAppColumnHelper } =
  await import("@/components/tables/data-table-hook");

const STUB_CONTEXT = {} as ActionContext;

/** Records the scope stack `CommandRegistry` reaches on every commit. */
function scopeProbe() {
  let current: string[] = [];
  function Probe() {
    const { scope } = useKeymapState();
    useLayoutEffect(() => {
      current = scope;
    });
    return null;
  }
  return { Probe, scope: () => current };
}

// happy-dom starts on about:blank, where the History API ignores every path.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;
const locate = (search = "") =>
  happyDOM.setURL(`http://localhost/project/1/tracks${search}`);

beforeEach(() => {
  locate();
});
afterEach(() => happyDOM.setURL(START_URL));

type RootProps = Omit<DataTableProps<Row>, "children" | "deleteKind">;

/** The root with only the grid composed into it. */
function GridOnly(props: RootProps) {
  return (
    <DataTable<Row> {...props} deleteKind="track">
      <DataTable.Grid<Row> />
    </DataTable>
  );
}

/** The root owning the URL, its source built the way a page table builds it. */
function UrlOwnedGrid(props: Omit<RootProps, "urlState">) {
  const urlState = useTableUrlState({ navigate: Boolean(props.serverPage) });
  return <GridOnly {...props} urlState={urlState} />;
}

describe("DataTable", () => {
  it("renders the parts composed into it through its statics", () => {
    const { container } = render(<GridOnly data={DATA} columns={columns} />);
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
    expect(container.querySelectorAll("table")).toHaveLength(1);
  });

  it("throws the context's named error for a part rendered outside it", () => {
    // React logs the failed render to the console as well; the assertion is on
    // the throw itself.
    expect(() => render(<DataTable.Grid<Row> />)).toThrow(
      "`useDataTable` must be used within a `DataTableProvider`."
    );
  });

  it("adopts its view state from the URL when given a URL source", async () => {
    locate("?q=Two");
    render(<UrlOwnedGrid data={DATA} columns={columns} />);
    await act(async () => {});
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("keeps its view state in React without a URL source", async () => {
    locate("?q=Two");
    render(<GridOnly data={DATA} columns={columns} />);
    await act(async () => {});
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("lets the URL's cols override a column hidden by default", async () => {
    locate("?cols=genre");
    render(
      <UrlOwnedGrid
        data={DATA}
        columns={columns}
        initiallyHiddenColumns={["genre"]}
      />
    );
    await act(async () => {});
    expect(screen.getByText("Rock")).toBeTruthy();
    expect(screen.getByText("Pop")).toBeTruthy();
  });

  it("claims the hotkey scope from mount only for the page's table", () => {
    const unclaimed = scopeProbe();
    render(
      <CommandRegistry commands={TABLE_COMMANDS} context={STUB_CONTEXT}>
        <GridOnly data={DATA} columns={columns} />
        <unclaimed.Probe />
      </CommandRegistry>
    );
    expect(unclaimed.scope()).not.toContain("table");

    const claimed = scopeProbe();
    render(
      <CommandRegistry commands={TABLE_COMMANDS} context={STUB_CONTEXT}>
        <GridOnly data={DATA} columns={columns} hotkeys="page" />
        <claimed.Probe />
      </CommandRegistry>
    );
    expect(claimed.scope()).toContain("table");
  });

  describe("peek", () => {
    const helper = createAppColumnHelper<Row>();
    const withIds = helper.columns([
      idColumn(helper),
      helper.accessor((row) => row.title, { id: "title", header: "Title" }),
    ]);
    const peek = {
      toPeekRow: (row: Row) => ({ id: row.id, title: row.title }),
      href: (row: Row) => `/track/${row.id}`,
      titleField: "title",
    };

    const openRow = async (inUrl?: boolean) => {
      render(
        <GridOnly
          data={DATA}
          columns={withIds}
          entityLabel="track"
          peek={{ ...peek, inUrl }}
        />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Peek track 10" }));
      });
    };

    it("mirrors the open row into the URL with inUrl", async () => {
      await openRow(true);
      expect(window.location.search).toBe("?peek=10");
    });

    it("leaves the URL alone without inUrl", async () => {
      await openRow();
      expect(window.location.search).toBe("");
    });
  });

  describe("actions", () => {
    const action: TableAction<Row> = {
      id: "archive",
      label: "Archive",
      offered: () => true,
      run: async () => ({ ok: true, message: "Archived" }),
    };

    function ActionsProbe() {
      const { actions } = useDataTable<Row>();
      return <p>{actions?.map((a) => a.id).join(",") ?? "no actions"}</p>;
    }

    const renderAs = (role: "editor" | "viewer") =>
      render(
        <ProjectProvider project={{ id: 1, name: "P", role }}>
          <DataTable<Row>
            data={DATA}
            columns={columns}
            actions={[action]}
            deleteKind="track"
          >
            <ActionsProbe />
          </DataTable>
        </ProjectProvider>
      );

    it("carries a declared action to the parts for an editor", () => {
      renderAs("editor");
      expect(screen.getByText("archive")).toBeTruthy();
    });

    it("withholds a declared action from a viewer", () => {
      renderAs("viewer");
      expect(screen.getByText("no actions")).toBeTruthy();
    });
  });
});
