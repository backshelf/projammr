import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import { useState } from "react";

import { customField } from "@/fields/custom-field-fixture";
import type { FieldConfig } from "@/fields/types";
import { customFieldCells } from "./custom-field-parts";
import type { EditableCellConfig } from "./generic-table-types";
import { useTableEditing } from "./use-table-editing";

type TestRow = {
  id: number;
  title: string;
  statusId: number | null;
  status?: { id: number; name: string } | null;
  fields?: Record<string, string | number | boolean>;
};

const mixing: NonNullable<FieldConfig["statuses"]>[number] = {
  id: 2,
  name: "Mixing",
  // eslint-disable-next-line no-restricted-syntax -- status fixture colourHex, not a class name
  colourHex: "#336699",
  percentage: 50,
  description: null,
  projectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const CUSTOM_FIELDS = [customField(4, "Notes", "text")];

const EDITABLE: Record<string, EditableCellConfig> = {
  title: { type: "text" },
  status: { type: "status", statuses: [mixing] },
  ...customFieldCells(CUSTOM_FIELDS),
};

const INITIAL: TestRow[] = [
  {
    id: 1,
    title: "Alpha",
    statusId: null,
    status: null,
    fields: { cf_4: "v1" },
  },
  { id: 2, title: "Beta", statusId: null, status: null, fields: {} },
];

function renderEditing(
  options: {
    canEdit?: boolean;
    onCellSave?:
      | ((rowId: number, field: string, value: unknown) => Promise<boolean>)
      | undefined;
  } = {}
) {
  const canEdit = options.canEdit ?? true;
  const onCellSave =
    "onCellSave" in options ? options.onCellSave : mock(async () => true);
  return renderHook(() => {
    const [data, setData] = useState<TestRow[]>(INITIAL);
    const editing = useTableEditing({
      editableCells: EDITABLE,
      onCellSave,
      canEdit,
      setData,
    });
    return { data, ...editing };
  });
}

describe("useTableEditing", () => {
  it("withholds editableCells and sets canSave false for viewers", () => {
    const { result } = renderEditing({ canEdit: false });
    expect(result.current.editableCells).toBeUndefined();
    expect(result.current.canSave).toBe(false);
  });

  it("returns false without mutating when onCellSave is absent", async () => {
    const { result } = renderEditing({ onCellSave: undefined });
    expect(result.current.canSave).toBe(false);

    let ok = true;
    await act(async () => {
      ok = await result.current.handleCellSave(1, "title", "Changed");
    });
    expect(ok).toBe(false);
    expect(result.current.data[0]?.title).toBe("Alpha");
  });

  it("applies optimistic updates and rolls back on save failure", async () => {
    let settle: (ok: boolean) => void = () => {};
    const onCellSave = mock(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        })
    );
    const { result } = renderEditing({ onCellSave });

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.handleCellSave(1, "title", "Updated");
    });
    expect(result.current.data[0]?.title).toBe("Updated");

    await act(async () => {
      settle(false);
      expect(await pending).toBe(false);
    });
    expect(result.current.data[0]?.title).toBe("Alpha");
  });

  it("patches status fields via the field kind optimisticPatch and custom fields via the fields bag", async () => {
    const onCellSave = mock(async () => true);
    const { result } = renderEditing({ onCellSave });

    await act(async () => {
      await result.current.handleCellSave(2, "statusId", mixing.id);
    });
    expect(result.current.data[1]?.statusId).toBe(mixing.id);
    expect(result.current.data[1]?.status?.name).toBe("Mixing");

    await act(async () => {
      await result.current.handleCellSave(1, "cf_4", null);
    });
    expect(result.current.data[0]?.fields).toEqual({});
  });
});
