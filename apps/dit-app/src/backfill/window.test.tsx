import { afterEach, describe, expect, test } from "bun:test";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import { BACKFILL_EVENT } from "../backfill-ipc";
import {
  argsOf,
  checkView,
  findView,
  mockBackfillApp,
  renderWindow,
  runView,
  teardown,
} from "./test-support";
import { createBackfillStore } from "./store";
import { BackfillRoot } from "./window";

afterEach(teardown);

describe("the window as the app loads it", () => {
  test("shows the app's view once get_backfill answers, and follows each dit://backfill push", async () => {
    mockBackfillApp(findView());
    render(
      <MotionProvider>
        <BackfillRoot store={createBackfillStore()} />
      </MotionProvider>
    );
    expect(screen.getByText("Waiting for the app…")).toBeTruthy();

    expect(
      await screen.findByText("Choose the folders your Live projects are in.")
    ).toBeTruthy();

    await emit(BACKFILL_EVENT, runView());
    await waitFor(() =>
      expect(
        screen.getByRole("listbox", { name: "Folders in the run" })
      ).toBeTruthy()
    );
    await emit(BACKFILL_EVENT, checkView());
    await waitFor(() =>
      expect(
        screen.getByRole("listbox", { name: "Folders to bring in" })
      ).toBeTruthy()
    );
  });

  test("says why when the app will not give a view", async () => {
    mockIPC(
      () => {
        throw "The app isn't running.";
      },
      { shouldMockEvents: true }
    );
    render(
      <MotionProvider>
        <BackfillRoot store={createBackfillStore()} />
      </MotionProvider>
    );

    expect(await screen.findByText("The app isn't running.")).toBeTruthy();
  });
});

describe("the window's keys across steps", () => {
  test("Esc in an open picker closes the picker, not the window", async () => {
    const calls = mockBackfillApp(checkView());
    renderWindow(checkView());

    const field = screen.getByRole("combobox", { name: "Goes into" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    await waitFor(() =>
      expect(field.getAttribute("aria-expanded")).toBe("true")
    );
    fireEvent.keyDown(field, { key: "Escape" });

    await waitFor(() =>
      expect(field.getAttribute("aria-expanded")).toBe("false")
    );
    expect(argsOf(calls, "backfill_close")).toEqual([]);
  });

  test("⌘↩ goes on from inside a picker", async () => {
    const calls = mockBackfillApp(checkView());
    renderWindow(checkView());

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Goes into" }), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() =>
      expect(argsOf(calls, "backfill_start")).toHaveLength(1)
    );
  });

  test("a step's own keys are off in the others", () => {
    const calls = mockBackfillApp(findView({ roots: ["/a"] }));
    renderWindow(findView({ roots: ["/a"] }));

    // Find has no Back.
    fireEvent.keyDown(window, { key: "[", metaKey: true });

    expect(argsOf(calls, "backfill_back")).toEqual([]);
  });
});
