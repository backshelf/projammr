import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  argsOf,
  mockBackfillApp,
  mother,
  renderWindow,
  runView,
  teardown,
} from "./test-support";
import { WindowOf } from "./test-window";

afterEach(teardown);

function list(): HTMLElement {
  return screen.getByRole("listbox", { name: "Folders in the run" });
}

function row(name: string): HTMLElement {
  const option = within(list())
    .getAllByRole("option")
    .find((entry) => entry.textContent?.startsWith(name));
  if (!option) throw new Error(`no row for ${name}`);
  return option;
}

describe("Bring in", () => {
  test("each folder shows its state in the spec's words", () => {
    const view = runView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(row("science").textContent).toBe("science1 of 3 sets");
    expect(row("halogen").textContent).toBe("halogen3.1 of 8.4 GB");
    expect(row("canopy").textContent).toBe(
      "canopyWaiting for projammr.example"
    );
    expect(row("orbit").textContent).toBe("orbitDone");
    expect(row("drift").textContent).toBe(
      "driftprojammr.example refused the push: Storage is full."
    );
    expect(row("lumen").textContent).toBe("lumenPaused");
    expect(row("vesper").textContent).toBe("vesperWaiting");
    expect(screen.getByText("Bring in").getAttribute("aria-current")).toBe(
      "step"
    );
  });

  test("a folder in the run draws no tick, and the list is one tab stop", () => {
    const view = runView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.queryAllByRole("checkbox", { hidden: true })).toEqual([]);
    expect(list().tabIndex).toBe(0);
    expect(document.activeElement).toBe(list());
  });

  test("the chosen folder shows sets committed, saves stored and data uploaded", () => {
    const view = runView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByRole("heading", { name: "science Project" })
    ).toBeTruthy();
    // The same line sits in the list row and under the folder's head.
    expect(screen.getAllByText("1 of 3 sets")).toHaveLength(2);
    const figures = screen.getByText("Sets committed").parentElement!;
    expect(within(figures).getByText("1 of 3")).toBeTruthy();
    expect(within(figures).getAllByText("–")).toHaveLength(2);
    expect(
      screen.getByRole("progressbar", { name: "science progress" })
    ).toBeTruthy();
  });

  test("a folder uploading shows its bytes against the whole", () => {
    const view = runView({
      chosen: {
        ...mother.chosen!,
        folder: mother.folders[1]!.path,
        name: "halogen Project",
      },
    });
    mockBackfillApp(view);
    renderWindow(view);

    const figures = screen.getByText("Data uploaded").parentElement!;
    expect(within(figures).getByText("3.1 of 8.4 GB")).toBeTruthy();
  });

  test("a folder that is done shows what it brought in", () => {
    const view = runView({
      chosen: {
        ...mother.chosen!,
        folder: mother.folders[3]!.path,
        name: "orbit Project",
      },
    });
    mockBackfillApp(view);
    renderWindow(view);

    const figures = screen.getByText("Sets committed").parentElement!;
    expect(within(figures).getByText("5")).toBeTruthy();
    expect(within(figures).getByText("37")).toBeTruthy();
    expect(within(figures).getByText("2.3 GB")).toBeTruthy();
  });

  test("a failed folder shows its reason and Try again, which runs it again", async () => {
    const drift = mother.folders[4]!;
    const view = runView({
      chosen: { ...mother.chosen!, folder: drift.path, name: drift.name },
    });
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(
      within(screen.getByRole("alert")).getByText(
        "projammr.example refused the push: Storage is full."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_retry")).toEqual([{ folder: drift.path }])
    );
  });

  test("choosing another folder asks the app to show it", async () => {
    const calls = mockBackfillApp(runView());
    renderWindow(runView());

    fireEvent.click(row("halogen"));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_choose")).toEqual([
        { folder: mother.folders[1]!.path },
      ])
    );
  });

  test("Pause stops the whole run", async () => {
    const calls = mockBackfillApp(runView());
    renderWindow(runView());

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_pause")).toHaveLength(1)
    );
  });

  test("a paused run says so, and Resume carries on where it stopped", async () => {
    const paused = runView({
      run: { ...mother.run!, running: false, paused: true },
    });
    const calls = mockBackfillApp(paused);
    renderWindow(paused);

    expect(
      screen.getByText("Paused. Resume to carry on where it stopped.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_resume")).toHaveLength(1)
    );
  });

  test("while the run goes the footer counts the folders done", () => {
    const view = runView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.getByText("1 of 2 folders done")).toBeTruthy();
  });

  test("there is no way back mid-run, and neither Esc nor ⌘[ nor ⌘↩ do anything", () => {
    const calls = mockBackfillApp(runView());
    renderWindow(runView());

    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    expect(calls).toEqual([]);
  });

  test("the live region says a folder finished or failed, and stays quiet for a count", () => {
    const view = runView();
    mockBackfillApp(view);
    const { rerender } = renderWindow(view);
    const region = (): string =>
      screen
        .getAllByRole("status")
        .find((node) => node.classList.contains("sr-only"))!.textContent ?? "";
    expect(region()).toBe("");

    // A count moves: nothing is said.
    const counted = {
      ...view,
      folders: view.folders.map((folder, index) =>
        index === 0
          ? {
              ...folder,
              state: { state: "committing" as const, done: 2, of: 3 },
            }
          : folder
      ),
    };
    rerender(<WindowOf view={counted} />);
    expect(region()).toBe("");

    // A folder finishes: it is said.
    const finished = {
      ...counted,
      folders: counted.folders.map((folder, index) =>
        index === 0 ? { ...folder, state: { state: "done" as const } } : folder
      ),
    };
    rerender(<WindowOf view={finished} />);
    expect(region()).toBe("science Project: done");

    // A folder fails: it is said with its reason.
    const failed = {
      ...finished,
      folders: finished.folders.map((folder, index) =>
        index === 1
          ? {
              ...folder,
              state: { state: "failed" as const, reason: "Storage is full." },
            }
          : folder
      ),
    };
    rerender(<WindowOf view={failed} />);
    expect(region()).toBe("halogen Project: failed. Storage is full.");
  });

  test("shows overall progress in the footer and jumps to an active folder when viewing another", async () => {
    const view = runView({
      chosen: {
        ...mother.chosen!,
        folder: mother.folders[3]!.path,
        name: "orbit Project",
      },
    });
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByRole("progressbar", { name: "Overall progress" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Jump to active" }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_choose")).toEqual([
        { folder: mother.folders[0]!.path },
      ])
    );
  });
});
