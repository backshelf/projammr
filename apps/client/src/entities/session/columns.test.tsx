import { cleanup, render, screen } from "@testing-library/react";
import type { ListSession, Machine } from "@workspace/api/api";
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
const { ProjectProvider } = await import("@/hooks/use-project-role");
const { sessionColumns } = await import("./columns");

afterEach(cleanup);

const machines = [
  { id: "m1", name: "studio", online: true, repoIds: [3], pushedRepos: [] },
] as unknown as Machine[];

const renderOpenCell = (repoId: number | null) => {
  const column = sessionColumns(1, [], undefined, machines).find(
    (c) => c.id === "actions"
  );
  const cell = column?.cell as (info: unknown) => React.ReactNode;
  render(<>{cell({ row: { original: { id: 9, repoId } as ListSession } })}</>);
  return screen.getByRole("button", {
    name: "Open in DAW",
  }) as HTMLButtonElement;
};

describe("session table Open in DAW", () => {
  it("enables a row whose repo a machine tracks, pushed or not", () => {
    expect(renderOpenCell(3).getAttribute("aria-disabled")).toBeNull();
  });

  it("marks a row aria-disabled when no machine tracks its repo or it has none", () => {
    expect(renderOpenCell(4).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    expect(renderOpenCell(null).getAttribute("aria-disabled")).toBe("true");
  });

  it("omits legacy scanner-only columns", () => {
    const ids = sessionColumns(1, [], undefined, machines).map((c) => c.id);
    expect(ids).not.toContain("machine");
    expect(ids).not.toContain("localFilepath");
    expect(ids).not.toContain("localFileUpdatedAt");
    expect(ids).not.toContain("localFileCreatedAt");
    expect(ids).toContain("inDit");
  });

  it("hides the Assign to a track button for viewers on unassigned sessions", () => {
    const column = sessionColumns(1, [], undefined, machines).find(
      (c) => c.id === "track"
    );
    const cell = column?.cell as (info: unknown) => React.ReactNode;
    const cellEl = cell({
      row: { original: { id: 9, track: null } as unknown as ListSession },
    });

    render(
      <ProjectProvider project={{ id: 1, name: "P", role: "viewer" }}>
        {cellEl}
      </ProjectProvider>
    );
    expect(
      screen.queryByRole("button", { name: "Assign to a track" })
    ).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();

    cleanup();
    render(
      <ProjectProvider project={{ id: 1, name: "P", role: "editor" }}>
        {cellEl}
      </ProjectProvider>
    );
    expect(
      screen.getByRole("button", { name: "Assign to a track" })
    ).toBeTruthy();
  });
});
