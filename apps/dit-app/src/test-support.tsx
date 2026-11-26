import type { ReactElement } from "react";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import fixture from "../fixtures/snapshot.json";
import type { Auth, Snapshot } from "./ipc";
import { Chrome } from "./test-chrome";
import type { Nav } from "./screen";

/** The contract fixture: signing in, a set open, two repos, an adopt offer. */
export const base = fixture as Snapshot;

/** The fixture with `changes` laid over it, one level deep. */
export function snapshotWith(changes: Partial<Snapshot>): Snapshot {
  return { ...base, ...changes };
}

/** A signed-in snapshot with nothing waiting: the quiet baseline a screen's test then bends. */
export function signedIn(changes: Partial<Snapshot> = {}): Snapshot {
  const auth: Auth = { ...base.auth, state: "signed-in", pending: null };
  return snapshotWith({
    auth,
    adoptOffer: null,
    adopting: null,
    notices: [],
    renders: [],
    pendingRestore: null,
    restore: { state: "idle" },
    machine: { name: "Studio Mac", refused: null },
    update: { state: "none" },
    backfill: null,
    ...changes,
  });
}

/**
 * Unmounts what a test rendered and then drops the mocked app. Listeners stop asynchronously, so the mocks must
 * outlive that or Tauri finds its event plumbing gone.
 */
export async function teardown(): Promise<void> {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
}

export type Call = { command: string; args: unknown };

/**
 * Stands in for the app: answers `get_snapshot` with `snapshot`, records every other command, and lets `answer`
 * decide what each one returns (a thrown value is a refusal, as the app's would be).
 */
export function mockApp(
  snapshot: Snapshot,
  answer?: (command: string, args: unknown) => unknown
): Call[] {
  const calls: Call[] = [];
  mockIPC(
    (command, args) => {
      if (command === "get_snapshot") return snapshot;
      calls.push({ command, args });
      return answer?.(command, args);
    },
    { shouldMockEvents: true }
  );
  return calls;
}

/** What the commands recorded in `calls` named `command` were called with. */
export function argsOf(calls: Call[], command: string): unknown[] {
  return calls.filter((call) => call.command === command).map((c) => c.args);
}

/** Renders one screen with the providers the panel gives it. */
export function renderScreen(
  screen: ReactElement,
  nav: Nav = "home"
): RenderResult {
  return render(<Chrome nav={nav}>{screen}</Chrome>);
}
