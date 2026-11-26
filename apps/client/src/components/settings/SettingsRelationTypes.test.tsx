import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { RelationTypeEntry } from "@workspace/api/api";

const reorderRelationTypes = mock(
  async (_projectId: number, ids: number[]): Promise<RelationTypeEntry[]> =>
    ids.map((id) => types.find((type) => type.id === id)!)
);

const deleteRelationType = mock<
  (projectId: number, typeId: number) => Promise<{ ok: true }>
>(async () => ({ ok: true }));

mock.module("@/actions/relation-types", () => ({
  createRelationType: mock(),
  renameRelationType: mock(),
  reorderRelationTypes,
  deleteRelationType,
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { SettingsRelationTypes } = await import("./SettingsRelationTypes");

const relationType = (
  id: number,
  name: string,
  inUse = 0
): RelationTypeEntry => ({ id, name, rank: id, inUse });

const types = [
  relationType(1, "remix of"),
  relationType(2, "sample of", 3),
  relationType(3, "alt version of"),
];

afterEach(() => {
  cleanup();
  reorderRelationTypes.mockClear();
  deleteRelationType.mockClear();
});

async function renderEditor(confirmRelationTypeDeletes = true) {
  await act(async () => {
    render(
      <PoliciesProvider
        policies={{
          ...DEFAULT_POLICIES,
          feedback: {
            ...DEFAULT_POLICIES.feedback,
            confirmDeletes: {
              ...DEFAULT_POLICIES.feedback.confirmDeletes,
              relationType: confirmRelationTypeDeletes,
            },
          },
        }}
      >
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={true}
        />
      </PoliciesProvider>
    );
  });
}

describe("SettingsRelationTypes", () => {
  it("shows a viewer the names and no controls", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={false}
        />
      );
    });

    expect(screen.getByText("remix of")).toBeTruthy();
    expect(screen.getByText("sample of")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add relation type" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("shows a type in use its count and a disabled delete", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={true}
        />
      );
    });

    expect(screen.getByText("3 relations use this type")).toBeTruthy();
    const deleteButton = screen.getByRole("button", {
      name: "Delete sample of",
    });
    expect(deleteButton).toHaveProperty("disabled", true);
    expect(deleteButton.getAttribute("aria-describedby")).toBe(
      screen.getByText("3 relations use this type").id
    );

    expect(
      screen.getByRole("button", { name: "Delete remix of" })
    ).toHaveProperty("disabled", false);
  });

  it("asks before deleting a relation type, and deletes it once confirmed", async () => {
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Delete remix of" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete “remix of”?")).toBeTruthy();
    expect(deleteRelationType).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete relation type" })
      );
    });

    expect(deleteRelationType).toHaveBeenCalledWith(7, 1);
  });

  it("keeps the relation type when the confirm is cancelled", async () => {
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Delete remix of" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(deleteRelationType).not.toHaveBeenCalled();
  });

  it("deletes a relation type straight away when relation type confirms are off", async () => {
    await renderEditor(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete remix of" }));
    });

    expect(deleteRelationType).toHaveBeenCalledWith(7, 1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("calls reorderRelationTypes with the first two ids swapped on Move down", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={true}
        />
      );
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Move remix of down" })
      );
    });

    expect(reorderRelationTypes).toHaveBeenCalledWith(7, [2, 1, 3]);
  });

  it("keeps focus on the arrow that moved a type once the row is re-placed", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={true}
        />
      );
    });

    // Held in flight, so the optimistic order stays in place to assert on.
    reorderRelationTypes.mockImplementationOnce(() => new Promise(() => {}));
    const down = screen.getByRole("button", { name: "Move remix of down" });
    await act(async () => {
      down.focus();
      fireEvent.click(down);
    });

    expect(reorderRelationTypes).toHaveBeenCalledWith(7, [2, 1, 3]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move remix of down" })
    );
  });

  it("moves focus to the other arrow when the pressed one is disabled at an end", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types.slice(0, 2)}
          canEdit={true}
        />
      );
    });

    reorderRelationTypes.mockImplementationOnce(() => new Promise(() => {}));
    const down = screen.getByRole("button", { name: "Move remix of down" });
    await act(async () => {
      down.focus();
      fireEvent.click(down);
    });

    expect(
      screen.getByRole("button", { name: "Move remix of down" })
    ).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move remix of up" })
    );
  });

  it("disables up on the first row and down on the last", async () => {
    await act(async () => {
      render(
        <SettingsRelationTypes
          projectId={7}
          relationTypes={types}
          canEdit={true}
        />
      );
    });

    expect(
      screen.getByRole("button", { name: "Move remix of up" })
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Move remix of down" })
    ).toHaveProperty("disabled", false);
    expect(
      screen.getByRole("button", { name: "Move alt version of down" })
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Move alt version of up" })
    ).toHaveProperty("disabled", false);
  });
});
