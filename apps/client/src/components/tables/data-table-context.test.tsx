import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";

import { CommandRegistry } from "@/components/commands/provider";
import { TABLE_COMMANDS } from "@/components/commands/tables";

import {
  type DataTableConfigValue,
  DataTableProvider,
  type DataTableStateValue,
  useDataTable,
  useDataTableConfig,
  useDataTableState,
} from "./data-table-context";
import {
  columns,
  DATA,
  DataTable,
  pressHotkey,
  type Row,
  STUB_CONTEXT,
} from "./test-support";

afterEach(cleanup);

// The hooks hand back whatever the provider holds, and only identities and a
// member or two are asserted, so each half is a stand-in.
const config = {
  table: {},
  data: [{ id: 1 }],
  entityLabel: "track",
  canEdit: true,
  setPeekId: () => {},
} as unknown as DataTableConfigValue<Row>;

const state = {
  cursorRowId: null,
  peekId: 7,
} as unknown as DataTableStateValue<Row>;

function Halves({
  config: configHalf = config,
  state: stateHalf = state,
  children,
}: {
  config?: DataTableConfigValue<Row>;
  state?: DataTableStateValue<Row>;
  children: ReactNode;
}) {
  return (
    <DataTableProvider config={configHalf} state={stateHalf}>
      {children}
    </DataTableProvider>
  );
}

describe("the data table context hooks", () => {
  it("hand back each half the provider holds", () => {
    const { result } = renderHook(
      () => ({
        config: useDataTableConfig<Row>(),
        state: useDataTableState<Row>(),
      }),
      { wrapper: Halves }
    );

    expect(result.current.config).toBe(config);
    expect(result.current.state).toBe(state);
  });

  it("merge both halves, keeping one merged value while neither changes", () => {
    const { result, rerender } = renderHook(() => useDataTable<Row>(), {
      wrapper: Halves,
    });
    const first = result.current;

    expect(first.entityLabel).toBe("track");
    expect(first.peekId).toBe(7);

    rerender();
    expect(result.current).toBe(first);
  });

  it.each<[string, () => unknown]>([
    ["useDataTable", () => useDataTable<Row>()],
    ["useDataTableConfig", () => useDataTableConfig<Row>()],
    ["useDataTableState", () => useDataTableState<Row>()],
  ])("%s throws a named error outside a DataTableProvider", (name, hook) => {
    // React logs the failed render to the console as well; the assertion is on
    // the throw itself.
    expect(() => renderHook(hook)).toThrow(
      `\`${name}\` must be used within a \`DataTableProvider\`.`
    );
  });
});

describe("the data table root's context halves", () => {
  const rows: Row[] = [
    ...DATA,
    { ...DATA[0]!, id: 12, title: "Three", notes: "third" },
  ];

  // Records the halves each time either one reaches a part.
  function renderRoot() {
    const seen: {
      config: DataTableConfigValue<Row>[];
      state: DataTableStateValue<Row>[];
    } = { config: [], state: [] };
    function Probe() {
      seen.config.push(useDataTableConfig<Row>());
      seen.state.push(useDataTableState<Row>());
      return null;
    }
    const root = (entityLabel: string) => (
      <CommandRegistry commands={TABLE_COMMANDS} context={STUB_CONTEXT}>
        <DataTable<Row>
          data={rows}
          columns={columns}
          entityLabel={entityLabel}
          deleteKind="track"
        >
          {/* `pressHotkey` claims the `table` scope through a real
              `[role="grid"]` node, so the root needs its actual grid
              mounted, not just the context probe. */}
          <DataTable.Grid<Row> />
          <Probe />
        </DataTable>
      </CommandRegistry>
    );
    const result = render(root("track"));
    return { ...result, seen, root };
  }

  it("keeps the config half when the cursor moves", () => {
    const { seen } = renderRoot();
    const config = seen.config.at(-1);
    const state = seen.state.at(-1);

    pressHotkey("j");

    expect(seen.state.at(-1)?.cursorRowId).toBe("10");
    expect(seen.state.at(-1)).not.toBe(state);
    expect(seen.config.at(-1)).toBe(config);
  });

  it("keeps the state half when only a prop changes", () => {
    const { seen, root, rerender } = renderRoot();
    const config = seen.config.at(-1);
    const state = seen.state.at(-1);

    rerender(root("song"));

    expect(seen.config.at(-1)?.entityLabel).toBe("song");
    expect(seen.config.at(-1)).not.toBe(config);
    expect(seen.state.at(-1)).toBe(state);
  });
});
