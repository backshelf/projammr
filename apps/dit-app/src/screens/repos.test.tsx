import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { RepoRow } from "../ipc";
import { argsOf, base, mockApp, renderScreen, teardown } from "../test-support";
import { Repos } from "./repos";

afterEach(teardown);

function repo(name: string, changes: Partial<RepoRow> = {}): RepoRow {
  return {
    path: `/Music/${name}`,
    name,
    unreachable: null,
    busy: false,
    lastCommit: null,
    lastActiveAt: null,
    webPath: null,
    ...changes,
  };
}

const NOW = Date.now();
const [science, other] = base.repos;

function titles(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector("[id]")?.textContent ?? "");
}

describe("Repos", () => {
  test("says how to get a first repo when there are none, with no filter to type in", () => {
    mockApp(base);
    renderScreen(<Repos repos={[]} />);

    expect(
      screen.getByText(
        "Open a set in Live and dit will offer to track its project, or track folders in bulk."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText("Filter repos")).toBeNull();
  });

  test("opens the backfill window from the first-run button, and shows why it would not open", async () => {
    const calls = mockApp(base, (command) => {
      if (command === "open_backfill" && calls.length > 1) throw "No window.";
    });
    renderScreen(<Repos repos={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Track a folder…" }));
    await waitFor(() => expect(argsOf(calls, "open_backfill")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Track a folder…" }));
    expect(await screen.findByText("No window.")).toBeTruthy();
  });

  test("has no first-run button once there are repos", () => {
    mockApp(base);
    renderScreen(<Repos repos={[science!]} />);

    expect(
      screen.queryByRole("button", { name: "Track a folder…" })
    ).toBeNull();
  });

  test("lists the most recently active repo first", () => {
    mockApp(base);
    renderScreen(
      <Repos
        repos={[
          repo("quiet"),
          repo("last week", { lastActiveAt: NOW - 7 * 86_400_000 }),
          repo("today", { lastActiveAt: NOW }),
        ]}
      />
    );

    expect(titles()).toEqual(["today", "last week", "quiet"]);
  });

  test("filters as you type, by name or folder, and says when nothing matches", () => {
    mockApp(base);
    renderScreen(<Repos repos={[repo("Science Project"), repo("Album")]} />);
    const filter = screen.getByLabelText("Filter repos");

    fireEvent.change(filter, { target: { value: "sci" } });
    expect(titles()).toEqual(["Science Project"]);

    fireEvent.change(filter, { target: { value: "nothing like it" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("No repo matches “nothing like it”.")).toBeTruthy();
  });

  test("shows the last commit's message and age", () => {
    mockApp(base);
    renderScreen(
      <Repos
        repos={[
          repo("science Project", {
            lastCommit: { message: "added strings", at: NOW - 3 * 3_600_000 },
          }),
          repo("new Project"),
        ]}
      />
    );

    const [first, second] = screen.getAllByRole("listitem");
    expect(first?.textContent).toContain("No commits yet");
    expect(second?.textContent).toMatch(/added strings · .*3/);
  });

  test("marks a repo that cannot be opened or is waiting for another writer", () => {
    mockApp(base);
    renderScreen(<Repos repos={[other!]} />);

    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain(
      "Can't open the folder: No such file or directory"
    );
    expect(row.textContent).toContain("waiting for repo");
    expect(
      within(row).queryByRole("button", { name: /Open on the web/ })
    ).toBeNull();
  });

  test("opens a repo's page on the web from a link beside the row, never inside one", async () => {
    const calls = mockApp(base);
    renderScreen(<Repos repos={[science!]} />);

    const open = screen.getByRole("button", { name: "Open on the web" });
    const row = screen.getByRole("listitem");
    expect(open.parentElement).toBe(row);
    expect(open.parentElement?.closest("a, button, [role=button]")).toBeNull();
    expect(open.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(open);

    await waitFor(() =>
      expect(argsOf(calls, "open_web")).toEqual([{ path: "/session/812" }])
    );
  });

  test("goes back from a repo list that was navigated to, not from one that is the home screen", () => {
    mockApp(base);
    const { unmount } = renderScreen(<Repos repos={[science!]} />, "repos");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    unmount();

    renderScreen(<Repos repos={[science!]} />, "home");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
