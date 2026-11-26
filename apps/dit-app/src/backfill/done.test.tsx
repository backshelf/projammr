import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { BackfillView } from "../backfill-ipc";
import {
  argsOf,
  folder,
  mockBackfillApp,
  mother,
  renderWindow,
  teardown,
  viewWith,
} from "./test-support";

afterEach(() => {
  document.documentElement.removeAttribute("data-motion");
  return teardown();
});

const DRIFT = mother.folders[4]!;

function doneView(changes: Partial<BackfillView> = {}): BackfillView {
  return viewWith({
    step: "done",
    folders: [{ ...mother.folders[3]!, state: { state: "done" } }, DRIFT],
    summary: {
      // Noon UTC on the 12th: March 2019 in every zone.
      firstSave: Date.UTC(2019, 2, 12, 12),
      saves: 3412,
      sets: 266,
      projects: 41,
    },
    sessionsPath: "/project/4/session/all?inDit=false",
    hubError: null,
    error: null,
    ...changes,
  });
}

describe("Done", () => {
  test("the readout replaces the frame and says how far back the history goes", () => {
    const view = doneView();
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText(
        "Your history goes back to March 2019: 3,412 saves across 266 sets in 41 projects."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
  });

  test("a single save, set and project read as singular", () => {
    const view = doneView({
      summary: {
        firstSave: Date.UTC(2019, 2, 12, 12),
        saves: 1,
        sets: 1,
        projects: 1,
      },
    });
    mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText(
        "Your history goes back to March 2019: 1 save across 1 set in 1 project."
      )
    ).toBeTruthy();
  });

  test("See sessions not in dit opens the instance's filtered list, and Done closes the window", async () => {
    const view = doneView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    fireEvent.click(
      screen.getByRole("button", { name: "See sessions not in dit" })
    );
    await waitFor(() =>
      expect(argsOf(calls, "open_web")).toEqual([
        { path: "/project/4/session/all?inDit=false" },
      ])
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(argsOf(calls, "backfill_close")).toHaveLength(1)
    );
  });

  test("focus lands on Done, and ⌘↩ is Done", async () => {
    const view = doneView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Done" })
    );
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(argsOf(calls, "backfill_close")).toHaveLength(1)
    );
  });

  test("a folder that failed stays listed with its reason and Try again", async () => {
    const view = doneView();
    const calls = mockBackfillApp(view);
    renderWindow(view);

    expect(
      screen.getByText("projammr.example refused the push: Storage is full.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(argsOf(calls, "backfill_retry")).toEqual([{ folder: DRIFT.path }])
    );
  });

  test("with every folder failed there is nothing to read out and nothing to open", () => {
    const view = doneView({
      folders: [DRIFT],
      summary: null,
      sessionsPath: null,
    });
    mockBackfillApp(view);
    renderWindow(view);

    expect(screen.getByText("Nothing was brought in.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "See sessions not in dit" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("Esc leaves the readout open: only Done closes it", () => {
    const view = doneView({
      folders: [folder("orbit", { state: { state: "done" } })],
    });
    const calls = mockBackfillApp(view);
    renderWindow(view);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(calls).toEqual([]);
  });

  test("the readout arrives with a fade, and under reduced motion it is simply there", () => {
    const view = doneView();
    mockBackfillApp(view);
    const { unmount } = renderWindow(view);
    expect(document.querySelector("[data-reduced-motion]")).toBeNull();
    unmount();

    document.documentElement.setAttribute("data-motion", "reduce");
    renderWindow(view);

    expect(document.querySelector("[data-reduced-motion]")).not.toBeNull();
    expect(
      screen.getByText(/^Your history goes back to March 2019/)
    ).toBeTruthy();
  });
});
