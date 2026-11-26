import { afterEach, describe, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import fixture from "../fixtures/snapshot.json";
import { call, onState } from "./bridge";
import type { Snapshot } from "./ipc";
import { STATE_EVENT } from "./ipc";

const snapshot = fixture as Snapshot;

afterEach(() => clearMocks());

describe("call", () => {
  test("invokes get_snapshot without arguments and returns the answer", async () => {
    const seen: [string, unknown][] = [];
    mockIPC((command, payload) => {
      seen.push([command, payload]);
      return snapshot;
    });

    expect(await call("get_snapshot")).toEqual(snapshot);
    expect(seen).toEqual([["get_snapshot", {}]]);
  });

  test("passes the argument object through", async () => {
    const seen: [string, unknown][] = [];
    mockIPC((command, payload) => {
      seen.push([command, payload]);
    });

    await call("commit", { set: "science123", message: "added strings" });
    expect(seen).toEqual([
      ["commit", { set: "science123", message: "added strings" }],
    ]);
  });

  test("rejects with the app's message", async () => {
    mockIPC(() => {
      throw "no such set";
    });

    await expect(call("sign_out")).rejects.toBe("no such set");
  });
});

describe("onState", () => {
  test("hands the handler each dit://state payload until stopped", async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const got: Snapshot[] = [];
    const stop = await onState((next) => got.push(next));

    await emit(STATE_EVENT, snapshot);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // mockIPC never drops a listener on unlisten, so Tauri logs a missing-callback line for this emit.
    await emit(STATE_EVENT, { ...snapshot, barTitle: "later" });

    expect(got).toEqual([snapshot]);
  });
});
