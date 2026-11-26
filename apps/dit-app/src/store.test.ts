import { afterEach, describe, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { waitFor } from "@workspace/test/wait-for";

import fixture from "../fixtures/snapshot.json";
import { STATE_EVENT, type Snapshot } from "./ipc";
import { createSnapshotStore } from "./store";

const snapshot = fixture as Snapshot;

afterEach(() => clearMocks());

describe("snapshot store", () => {
  test("reads get_snapshot when the first subscriber arrives", async () => {
    mockIPC(() => snapshot, { shouldMockEvents: true });
    const store = createSnapshotStore();
    expect(store.getState().snapshot).toBeNull();

    const unsubscribe = store.subscribe(() => {});
    await waitFor(() => expect(store.getState().snapshot).toEqual(snapshot));
    unsubscribe();
  });

  test("applies a dit://state payload and tells the subscribers", async () => {
    mockIPC(() => snapshot, { shouldMockEvents: true });
    const store = createSnapshotStore();
    let told = 0;
    const unsubscribe = store.subscribe(() => told++);
    await waitFor(() => expect(store.getState().snapshot).toEqual(snapshot));
    const before = told;

    const next: Snapshot = { ...snapshot, barTitle: "science123 ● 4" };
    await emit(STATE_EVENT, next);

    expect(store.getState().snapshot).toEqual(next);
    expect(told).toBe(before + 1);
    unsubscribe();
  });

  test("keeps a push that lands before get_snapshot answers", async () => {
    const next: Snapshot = { ...snapshot, barTitle: "newer" };
    let answer: (value: Snapshot) => void = () => {};
    mockIPC(() => new Promise<Snapshot>((resolve) => (answer = resolve)), {
      shouldMockEvents: true,
    });
    const store = createSnapshotStore();
    const unsubscribe = store.subscribe(() => {});

    await waitFor(() => expect(answer).not.toBeUndefined());
    await emit(STATE_EVENT, next);
    answer(snapshot);
    await Promise.resolve();

    expect(store.getState().snapshot).toEqual(next);
    unsubscribe();
  });

  test("reports a failed get_snapshot", async () => {
    mockIPC(
      () => {
        throw "the daemon is not up";
      },
      { shouldMockEvents: true }
    );
    const store = createSnapshotStore();
    const unsubscribe = store.subscribe(() => {});

    await waitFor(() =>
      expect(store.getState().error).toBe("the daemon is not up")
    );
    unsubscribe();
  });

  test("stops listening with the last subscriber", async () => {
    mockIPC(() => snapshot, { shouldMockEvents: true });
    const store = createSnapshotStore();
    const unsubscribe = store.subscribe(() => {});
    await waitFor(() => expect(store.getState().snapshot).toEqual(snapshot));
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // mockIPC never drops a listener on unlisten, so Tauri logs a missing-callback line for this emit.
    await emit(STATE_EVENT, { ...snapshot, barTitle: "ignored" });
    expect(store.getState().snapshot).toEqual(snapshot);
  });
});
