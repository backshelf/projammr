import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ActionError, RelationTypeEntry } from "@workspace/api/api";

type TypesResult = RelationTypeEntry[] | ActionError;

let resolveTypes: (result: TypesResult) => void = () => {};
const getRelationTypes = mock(
  () => new Promise<TypesResult>((resolve) => (resolveTypes = resolve))
);

mock.module("server-only", () => ({}));
mock.module("@/actions/relation-types", () => ({ getRelationTypes }));
mock.module("@/actions/tracks", () => ({
  getTrackSummaries: mock(async () => []),
}));
mock.module("@/entities/mutations", () => ({ addTrackRelation: mock() }));
mock.module("@/hooks/use-mutate", () => ({ useMutate: mock(() => mock()) }));
mock.module("@/hooks/use-project-role", () => ({
  useProject: mock(() => ({ id: 7 })),
}));
mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { RelationSelector } = await import("./RelationSelector");

afterEach(() => {
  cleanup();
  getRelationTypes.mockClear();
});

const relationType = (id: number, name: string): RelationTypeEntry => ({
  id,
  name,
  rank: id,
  inUse: 0,
});

describe("RelationSelector", () => {
  it("disables the type select while the types load", async () => {
    render(<RelationSelector trackId={1} />);

    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
    expect(screen.queryByText(/no relation types/i)).toBeNull();
    await act(async () => resolveTypes([relationType(1, "remix")]));
  });

  it("shows the error and no picker when the types fail to load", async () => {
    render(<RelationSelector trackId={1} />);
    await act(async () => resolveTypes({ error: "Could not load types" }));

    expect(screen.getByRole("alert").textContent).toBe("Could not load types");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("links to the relation types settings when the project has none", async () => {
    render(<RelationSelector trackId={1} />);
    await act(async () => resolveTypes([]));

    expect(screen.getByText(/no relation types/i)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Add one in Settings" })
        .getAttribute("href")
    ).toBe("/settings/project/7/relation-types");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the type select once types are loaded", async () => {
    render(<RelationSelector trackId={1} />);
    await act(async () => resolveTypes([relationType(1, "remix")]));

    expect(screen.getByRole("combobox")).toHaveProperty("disabled", false);
  });
});
