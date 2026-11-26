import { cleanup, render, screen } from "@testing-library/react";
import type { ListSession, Machine } from "@workspace/api/api";
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
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
    expect(renderOpenCell(3).disabled).toBe(false);
  });

  it("disables a row whose repo no machine tracks, or that has none", () => {
    expect(renderOpenCell(4).disabled).toBe(true);
    cleanup();
    expect(renderOpenCell(null).disabled).toBe(true);
  });
});
