import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import type { Repo } from "@workspace/api/api";

import "./test-support";

const { ReposTable, branchCount } = await import("./ReposTable");

const tip = {
  commitId: 1,
  message: "Bass",
  committedAt: "2026-06-01T10:00:00Z",
};

const MACHINE = {
  id: "machine-0001-abcdef",
  name: "studio-mac",
  userId: "u1",
  removed: false,
};

const repo = (id: number, overrides: Partial<Repo> = {}): Repo =>
  ({
    id,
    projectId: 1,
    name: `Folder ${id}`,
    lastPushAt: "2026-06-01T10:00:00.000Z",
    lastPushMachine: MACHINE,
    storage: { setBytes: 2048, sampleBytes: 1024, sharedBytes: 0 },
    sets: [
      {
        ditSetId: "a",
        sessionId: 10,
        sessionName: "One",
        branches: [
          { name: "main", tip },
          { name: "side", tip: null },
        ],
      },
      { ditSetId: "b", sessionId: 11, sessionName: "Two", branches: [] },
    ],
    ...overrides,
  }) as unknown as Repo;

// happy-dom starts on about:blank, where `history.replaceState` is ignored.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

afterEach(() => happyDOM.setURL(START_URL));

async function renderRepos(repos: Repo[], viewerId: string | null = "u1") {
  happyDOM.setURL("http://localhost/project/1/track/3");
  const result = render(
    <ReposTable repos={repos} projectId={1} viewerId={viewerId} />
  );
  await act(async () => {});
  return result;
}

const rowOf = (name: string) =>
  screen.getByRole("link", { name }).closest("tr, [role=row]")!;

describe("ReposTable", () => {
  it("links each row's name to its repo page", async () => {
    await renderRepos([repo(5), repo(6)]);

    const link = screen.getByRole("link", { name: "Folder 5" });
    expect(link.getAttribute("href")).toBe("/project/1/repo/5");
    expect(
      screen.getByRole("link", { name: "Folder 6" }).getAttribute("href")
    ).toBe("/project/1/repo/6");
  });

  it("reads sets and branches, with the last push and its machine in columns of their own", async () => {
    await renderRepos([repo(5)]);

    expect(
      screen.getByRole("columnheader", { name: /Last Push/ })
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Machine/ })).toBeTruthy();
    const row = rowOf("Folder 5");
    expect(row.textContent).toContain("2");
    expect(row.textContent).toContain("studio-mac");
    expect(row.textContent).not.toContain("from studio-mac");
  });

  it("links the machine to its row in Settings when it is the viewer's", async () => {
    await renderRepos([repo(5)], "u1");

    const link = screen.getByRole("link", { name: "studio-mac" });
    expect(link.getAttribute("href")).toBe(
      "/settings/devices#machine-machine-0001-abcdef"
    );
  });

  it("leaves another user's machine as plain text", async () => {
    await renderRepos(
      [repo(5, { lastPushMachine: { ...MACHINE, userId: "u2" } })],
      "u1"
    );

    expect(rowOf("Folder 5").textContent).toContain("studio-mac");
    expect(screen.queryByRole("link", { name: "studio-mac" })).toBeNull();
  });

  it("shows a dash for a push that named no machine", async () => {
    await renderRepos([repo(5, { lastPushMachine: null })]);

    expect(screen.queryByText("studio-mac")).toBeNull();
    expect(rowOf("Folder 5").textContent).toContain("—");
  });

  it("reads a repo's storage as its sets and samples together", async () => {
    await renderRepos([repo(5)]);

    expect(rowOf("Folder 5").textContent).toContain("3 KB");
  });

  it("offers no selection or delete", async () => {
    await renderRepos([repo(5)]);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("counts a repo's branches across its sets", () => {
    expect(branchCount(repo(5))).toBe(2);
    expect(branchCount(repo(6, { sets: [] }))).toBe(0);
  });
});
