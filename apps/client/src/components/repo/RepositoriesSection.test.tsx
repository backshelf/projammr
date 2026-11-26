import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Repo } from "@workspace/api/api";

import "@/components/tables/test-support";

const { sessionUser } = await import("@/lib/session-state");

const session: Parameters<typeof sessionUser>[0] = {
  kind: "member",
  user: { id: "u1" },
} as unknown as Parameters<typeof sessionUser>[0];
mock.module("@/lib/session", () => ({
  getCachedSession: async () => session,
  sessionUser,
}));

mock.module("@/components/tables/ReposTable", () => ({
  ReposTable: ({
    repos,
    viewerId,
  }: {
    repos: Repo[];
    viewerId: string | null;
  }) => (
    <ul data-viewer={viewerId ?? "none"}>
      {repos.map((repo) => (
        <li key={repo.id}>{repo.name}</li>
      ))}
    </ul>
  ),
}));

const { RepositoriesSection } = await import("./RepositoriesSection");

afterEach(cleanup);

const repo = { id: 5, name: "Studio folder" } as unknown as Repo;

describe("RepositoriesSection", () => {
  it("renders nothing while no repo holds one of the page's sets", async () => {
    expect(
      await RepositoriesSection({
        reposPromise: Promise.resolve([]),
        projectId: 1,
      })
    ).toBeNull();
  });

  it("renders nothing when the read fails", async () => {
    expect(
      await RepositoriesSection({
        reposPromise: Promise.resolve({ error: "nope", status: 500 }),
        projectId: 1,
      })
    ).toBeNull();
  });

  it("heads the table with its count once a repo holds a set", async () => {
    render(
      await RepositoriesSection({
        reposPromise: Promise.resolve([repo]),
        projectId: 1,
      })
    );
    expect(screen.getByRole("heading", { name: /REPOSITORIES/ })).toBeTruthy();
    expect(screen.getByText("Studio folder")).toBeTruthy();
  });

  it("hands the table the signed-in user, whose machines it may link", async () => {
    const { container } = render(
      await RepositoriesSection({
        reposPromise: Promise.resolve([repo]),
        projectId: 1,
      })
    );
    expect(
      container.querySelector("[data-viewer]")?.getAttribute("data-viewer")
    ).toBe("u1");
  });
});
