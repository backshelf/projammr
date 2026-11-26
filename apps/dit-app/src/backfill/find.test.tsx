import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { BackfillChosen, BackfillView } from "../backfill-ipc";
import {
  argsOf,
  findView,
  folder,
  mockBackfillApp,
  mother,
  renderWindow,
  teardown,
} from "./test-support";

afterEach(teardown);

const ROOT = "/Users/me/Music/Ableton";
const SCIENCE = folder("science", { sets: 8, bytes: 2469606195 });
const HALOGEN = folder("halogen", { sets: 1, bytes: 83886080 });
const OLD = folder("old", { already: true });

const SETS: BackfillChosen = {
  ...mother.chosen!,
  folder: SCIENCE.path,
  name: SCIENCE.name,
  project: null,
  tracks: [],
  sessions: [],
  sets: [
    {
      file: `${SCIENCE.path}/science123.als`,
      name: "science123",
      setId: null,
      copies: 4,
      saves: null,
      doubt: null,
      target: null,
      matched: null,
    },
  ],
};

function found(): BackfillView {
  return findView({
    roots: [ROOT],
    folders: [SCIENCE, HALOGEN, OLD],
    chosen: SETS,
  });
}

function list(): HTMLElement {
  return screen.getByRole("listbox", { name: "Folders found" });
}

function press(
  element: HTMLElement,
  key: string,
  init: KeyboardEventInit = {}
): void {
  fireEvent.keyDown(element, { key, ...init });
}

describe("Find", () => {
  test("with no roots says what to choose, and has nothing to go on with", () => {
    mockBackfillApp(findView());
    renderWindow(findView());

    expect(
      screen.getByText("Choose the folders your Live projects are in.")
    ).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByText("Find").getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Check").getAttribute("aria-current")).toBeNull();
  });

  test("focus lands on Choose folders…", () => {
    mockBackfillApp(findView());
    renderWindow(findView());

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Choose folders…" })
    );
  });

  test("Choose folders… adds the picked folder to the roots, and ⌘O does the same", async () => {
    const calls = mockBackfillApp(findView(), (command) =>
      command === "plugin:dialog|open" ? [ROOT] : undefined
    );
    renderWindow(findView());

    fireEvent.click(screen.getByRole("button", { name: "Choose folders…" }));
    await waitFor(() =>
      expect(argsOf(calls, "backfill_roots")).toEqual([{ roots: [ROOT] }])
    );

    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() =>
      expect(argsOf(calls, "backfill_roots")).toHaveLength(2)
    );
  });

  test("a root is listed and removable by name", async () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());

    expect(screen.getByText(ROOT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Remove ${ROOT}` }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_roots")).toEqual([{ roots: [] }])
    );
  });

  test("searching says how many projects it has found so far, as they appear", () => {
    const view = findView({
      roots: [ROOT],
      searching: true,
      folders: [SCIENCE, HALOGEN],
      chosen: SETS,
    });
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.getByText("Searching… 2 projects so far")).toBeTruthy();
    expect(within(list()).getAllByRole("option")).toHaveLength(2);
  });

  test("none found under the roots says so", () => {
    const view = findView({ roots: [ROOT] });
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText("No Live projects under these folders.")
    ).toBeTruthy();
  });

  test("lists each folder with its sets, size and newest save, newest first as the app sorted them", () => {
    mockBackfillApp(found());
    renderWindow(found());

    const options = within(list()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "science8 sets · 2.3 GB · last saved 12 Mar 2024",
      "halogen1 set · 80 MB · last saved 12 Mar 2024",
      "oldAlready in dit",
    ]);
  });

  test("a folder is ticked until it is unticked, and one that is already in dit cannot be ticked", () => {
    mockBackfillApp(found());
    renderWindow(found());

    const [science, halogen, old] = within(list()).getAllByRole("option");
    expect(science!.getAttribute("aria-selected")).toBe("true");
    expect(halogen!.getAttribute("aria-selected")).toBe("true");
    expect(old!.getAttribute("aria-selected")).toBe("false");
    expect(old!.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("2 of 2 ticked")).toBeTruthy();
  });

  test("when everything is already in dit it says so and Next stays off", () => {
    const view = findView({ roots: [ROOT], folders: [OLD], chosen: null });
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.getByText("Everything here is already in dit.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test("Space unticks the chosen folder and ticks it again; a folder already in dit ignores it", () => {
    const view = { ...found(), chosen: { ...SETS, folder: OLD.path } };
    mockBackfillApp(view);
    renderWindow(view);

    press(list(), " ");
    expect(
      within(list()).getAllByRole("option")[2]!.getAttribute("aria-selected")
    ).toBe("false");
    expect(screen.getByText("2 of 2 ticked")).toBeTruthy();
  });

  test("Space on a ticked folder unticks it, and Next goes on with the folders still ticked", async () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());

    press(list(), " ");
    expect(
      within(list()).getAllByRole("option")[0]!.getAttribute("aria-selected")
    ).toBe("false");
    expect(screen.getByText("1 of 2 ticked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(argsOf(calls, "backfill_check")).toEqual([
        { folders: [HALOGEN.path] },
      ])
    );
  });

  test("clicking a tick unticks that folder, and nothing ticked leaves Next off", () => {
    mockBackfillApp(found());
    renderWindow(found());

    for (const box of screen.getAllByRole("checkbox", { hidden: true })) {
      if (!(box as HTMLInputElement).disabled) fireEvent.click(box);
    }

    expect(screen.getByText("0 of 2 ticked")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test("↩ on the list and ⌘↩ anywhere are Next", async () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());

    press(list(), "Enter");
    await waitFor(() =>
      expect(argsOf(calls, "backfill_check")).toHaveLength(1)
    );

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(argsOf(calls, "backfill_check")).toHaveLength(2)
    );
    expect(argsOf(calls, "backfill_check")[1]).toEqual({
      folders: [SCIENCE.path, HALOGEN.path],
    });
  });

  test("with nothing ticked neither ↩ nor ⌘↩ goes on", () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());
    for (const box of screen.getAllByRole("checkbox", { hidden: true })) {
      if (!(box as HTMLInputElement).disabled) fireEvent.click(box);
    }

    press(list(), "Enter");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    expect(argsOf(calls, "backfill_check")).toEqual([]);
  });

  test("↑ and ↓ choose the folder next door, and the list is one tab stop", async () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());

    press(list(), "ArrowDown");
    await waitFor(() =>
      expect(argsOf(calls, "backfill_choose")).toEqual([
        { folder: HALOGEN.path },
      ])
    );
    expect(list().tabIndex).toBe(0);
    for (const option of within(list()).getAllByRole("option")) {
      expect(option.tabIndex).toBeLessThan(0);
    }
    expect(list().getAttribute("aria-activedescendant")).toBe(
      within(list()).getAllByRole("option")[0]!.id
    );
  });

  test("shows the chosen folder's sets with their backups", () => {
    mockBackfillApp(found());
    renderWindow(found());

    expect(
      screen.getByRole("heading", { name: "science Project" })
    ).toBeTruthy();
    const sets = within(screen.getByRole("list", { name: "Sets" }));
    expect(sets.getByText("science123")).toBeTruthy();
    expect(sets.getByText("4 backups")).toBeTruthy();
  });

  test("Esc closes the window, leaving nothing behind", async () => {
    const calls = mockBackfillApp(found());
    renderWindow(found());

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(argsOf(calls, "backfill_close")).toHaveLength(1)
    );
  });

  test("a refused command is a line in the window, and the next command clears it", async () => {
    mockBackfillApp(found(), (command) => {
      if (command === "backfill_check")
        throw "Not signed in to projammr.example.";
      return undefined;
    });
    renderWindow(found());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Not signed in to projammr.example."
    );
  });
});
