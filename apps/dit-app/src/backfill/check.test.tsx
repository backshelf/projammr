import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  argsOf,
  checkView,
  folder,
  mockBackfillApp,
  mother,
  renderWindow,
  teardown,
} from "./test-support";

afterEach(teardown);

const SCIENCE = mother.folders[0]!.path;
const [matched, unreadable, unrecorded, fresh] = mother.chosen!.sets;

function picker(name: string): HTMLInputElement {
  return screen.getByRole("combobox", { name }) as HTMLInputElement;
}

async function choose(field: HTMLInputElement, option: string): Promise<void> {
  fireEvent.keyDown(field, { key: "ArrowDown" });
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item);
  fireEvent.click(item);
}

describe("Check", () => {
  test("reading sets shows each folder's progress in the list, and Start waits", () => {
    const view = checkView({
      folders: [
        { ...folder("tide"), state: { state: "reading", read: 12, of: 41 } },
        folder("ember", { state: { state: "checked" } }),
      ],
      storage: null,
      canStart: false,
    });
    mockBackfillApp(view);
    renderWindow(view);

    const list = screen.getByRole("listbox", { name: "Folders to bring in" });
    expect(within(list).getByText("Reading sets · 12 of 41")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByText("Check").getAttribute("aria-current")).toBe("step");
  });

  test("lists each folder with its set count and what is in doubt", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    const list = screen.getByRole("listbox", { name: "Folders to bring in" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "science3 sets · 1 couldn't be read · synced by iCloud Drive",
      "halogen3 sets",
    ]);
  });

  test("focus lands on the folder list", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Folders to bring in" })
    );
  });

  test("the chosen folder's head names its project, the track and session of each set show the proposals", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByRole("heading", { name: "science Project" })
    ).toBeTruthy();
    expect(picker("Goes into").value).toBe("Alex");
    expect(picker(`Session for ${matched!.name}`).value).toBe(
      "Matches 'science123' on Science"
    );
    expect(picker(`Track for ${matched!.name}`).value).toBe("Science");
    expect(picker(`Session for ${unreadable!.name}`).value).toBe("New session");
    expect(picker(`Track for ${unreadable!.name}`).value).toBe("Science");
    expect(picker(`Session for ${fresh!.name}`).value).toBe("New session");
    expect(picker(`Track for ${fresh!.name}`).value).toBe("New track: science");
    expect(screen.getByText("4 backups")).toBeTruthy();
    expect(screen.getByText("9 backups")).toBeTruthy();
    expect(screen.getByText("0 backups")).toBeTruthy();
  });

  test("a set that matches a session keeps the session's track: its picker only shows it", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(picker(`Track for ${matched!.name}`).disabled).toBe(true);
    expect(picker(`Track for ${unreadable!.name}`).disabled).toBe(false);
  });

  test("a set Check could not read is stored as it is, and one it could not record says why", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText(
        "Couldn't read this set. It's stored as it is and read again later."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("science alt.als changed while it was read.")
    ).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: `Track for ${unrecorded!.name}` })
    ).toBeNull();
  });

  test("a folder synced by another service shows the adopt warning, and can still go on", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText(
        "This folder is synced by iCloud Drive. Two computers sharing one repo will corrupt it."
      )
    ).toBeTruthy();
  });

  test("changing a set's track sends it, as an existing track or as the folder's new one", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    await choose(picker(`Track for ${unreadable!.name}`), "Halogen");
    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_target")).toEqual([
        {
          folder: SCIENCE,
          file: unreadable!.file,
          target: { kind: "track", id: 12 },
        },
      ])
    );

    await choose(picker(`Track for ${unreadable!.name}`), "New track: science");
    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_target")[1]).toEqual({
        folder: SCIENCE,
        file: unreadable!.file,
        target: { kind: "new-track", name: "science" },
      })
    );
  });

  test("the session picker offers the project's free sessions and New session", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    const field = picker(`Session for ${unreadable!.name}`);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const options = await screen.findAllByRole("option");

    // 812 is matched to another set of the folder; 813 is free.
    expect(options.map((option) => option.textContent)).toEqual([
      "New session",
      "Matches 'science old mix'",
    ]);
    fireEvent.pointerDown(options[1]!);
    fireEvent.click(options[1]!);
    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_target")).toEqual([
        {
          folder: SCIENCE,
          file: unreadable!.file,
          target: { kind: "session", id: 813 },
        },
      ])
    );
  });

  test("picking New session for a matched set puts it on a new session in the matched session's track", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    await choose(picker(`Session for ${matched!.name}`), "New session");

    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_target")).toEqual([
        {
          folder: SCIENCE,
          file: matched!.file,
          target: { kind: "track", id: 11 },
        },
      ])
    );
  });

  test("the pickers filter as you type", async () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    const field = picker(`Session for ${fresh!.name}`);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    await screen.findAllByRole("option");
    fireEvent.change(field, { target: { value: "old" } });

    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((option) => option.textContent)
      ).toEqual(["Matches 'science old mix'"])
    );
  });

  test("moving the folder to another project sends the project", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    await choose(picker("Goes into"), "Collabs");

    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_project")).toEqual([
        { folder: SCIENCE, project: 9 },
      ])
    );
  });

  test("the footer holds the storage line, Back and Start", () => {
    const view = checkView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.getByText("Needs 8.4 GB of your 31 GB left.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test("storage over the room left says how much to untick, and Start is off", () => {
    const view = checkView({
      storage: { bytes: 15246204518, remaining: 10522669875 },
      canStart: false,
    });
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText(
        "These folders need 14.2 GB and you have 9.8 GB left. Go back (⌘[) to untick folders until they fit."
      )
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test("explains why a matched session locks the track picker and applies a project to all folders", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText("Uses the matched session’s track.")
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Apply to all folders" })
    );

    await waitFor(() =>
      expect(argsOf(calls, "backfill_set_project")).toEqual([
        { folder: SCIENCE, project: 4 },
        { folder: mother.folders[1]!.path, project: 4 },
      ])
    );
  });

  test("with no storage cap it says so and never blocks", () => {
    const view = checkView({
      storage: { bytes: 15246204518, remaining: null },
    });
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText("Needs 14.2 GB. No storage limit on this instance.")
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test("when the hub cannot be reached it says so with Try again, which checks the folders again, and Start is off", async () => {
    const view = checkView({
      hubError: "Can't reach projammr.example to check your sessions.",
      canStart: false,
      storage: null,
    });
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText("Can't reach projammr.example to check your sessions.")
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    // No proposals to make: the sets are listed by name alone.
    expect(
      screen
        .queryByRole("combobox", { name: "Goes into" })
        ?.hasAttribute("disabled")
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(argsOf(calls, "backfill_check")).toEqual([
        { folders: view.folders.map((entry) => entry.path) },
      ])
    );
  });

  test("Start, ⌘↩ and ↩ on the list start the run; Back and ⌘[ go back; Esc closes", async () => {
    const view = checkView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(
      screen.getByRole("listbox", { name: "Folders to bring in" }),
      { key: "Enter" }
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(argsOf(calls, "backfill_start")).toHaveLength(3);
      expect(argsOf(calls, "backfill_back")).toHaveLength(2);
      expect(argsOf(calls, "backfill_close")).toHaveLength(1);
    });
  });

  test("⌘↩ does not start while Start is off", () => {
    const view = checkView({ canStart: false });
    const calls = mockBackfillApp(view);
    renderWindow(view);

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    expect(argsOf(calls, "backfill_start")).toEqual([]);
  });

  test("a refusal of a set's target shows as a line", async () => {
    const view = checkView();
    mockBackfillApp(view, (command) => {
      if (command === "backfill_set_target") {
        throw "science123 is matched to another set already.";
      }
      return undefined;
    });
    renderWindow(view);

    await choose(picker(`Track for ${unreadable!.name}`), "Halogen");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "science123 is matched to another set already."
    );
  });
});
