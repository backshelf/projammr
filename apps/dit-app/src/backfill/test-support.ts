import { createElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";

import fixture from "../../fixtures/backfill.json";
import type {
  BackfillFolder,
  BackfillFolderState,
  BackfillView,
} from "../backfill-ipc";
import { WindowOf } from "./test-window";

export { argsOf, teardown } from "../test-support";

/** The contract fixture: a run on Bring in with one folder in each state and the chosen folder's proposals. */
export const mother = fixture as BackfillView;

const ABLETON = "/Users/me/Music/Ableton";

/** A folder the way Find lists it, newest first; `changes` bend it. */
export function folder(
  name: string,
  changes: Partial<BackfillFolder> = {}
): BackfillFolder {
  return {
    path: `${ABLETON}/${name} Project`,
    name: `${name} Project`,
    title: name,
    sets: 3,
    bytes: 2469606195,
    // Noon UTC: the same calendar day in every zone the suite might run in.
    newest: Date.UTC(2024, 2, 12, 12),
    already: false,
    state: { state: "idle" },
    doubt: null,
    ...changes,
  };
}

/** A folder in `state`. */
export function inState(
  name: string,
  state: BackfillFolderState,
  changes: Partial<BackfillFolder> = {}
): BackfillFolder {
  return folder(name, { state, ...changes });
}

/** The fixture with `changes` laid over it, one level deep. */
export function viewWith(changes: Partial<BackfillView>): BackfillView {
  return { ...mother, ...changes };
}

/** A view of Find with nothing found yet: the baseline the Find tests bend. */
export function findView(changes: Partial<BackfillView> = {}): BackfillView {
  return viewWith({
    step: "find",
    roots: [],
    searching: false,
    folders: [],
    chosen: null,
    projects: [],
    storage: null,
    hubError: null,
    canStart: false,
    run: null,
    summary: null,
    sessionsPath: null,
    error: null,
    ...changes,
  });
}

/** The fixture as Check shows it: read, with the hub answered and the storage fitting. */
export function checkView(changes: Partial<BackfillView> = {}): BackfillView {
  return viewWith({
    step: "check",
    folders: [
      { ...mother.folders[0]!, state: { state: "checked" } },
      folder("halogen", { state: { state: "checked" } }),
    ],
    run: null,
    summary: null,
    sessionsPath: null,
    hubError: null,
    canStart: true,
    error: null,
    ...changes,
  });
}

/** The fixture as Bring in shows it. */
export function runView(changes: Partial<BackfillView> = {}): BackfillView {
  return viewWith({
    step: "bring-in",
    hubError: null,
    error: null,
    ...changes,
  });
}

/**
 * Stands in for the app: answers `get_backfill` with `view`, records every other command, and lets `answer` decide
 * what each returns (a thrown value is a refusal, as the app's would be).
 */
export function mockBackfillApp(
  view: BackfillView,
  answer?: (command: string, args: unknown) => unknown
): { command: string; args: unknown }[] {
  const calls: { command: string; args: unknown }[] = [];
  mockIPC(
    (command, args) => {
      if (command === "get_backfill") return view;
      calls.push({ command, args });
      return answer?.(command, args);
    },
    { shouldMockEvents: true }
  );
  return calls;
}

/** Renders the window on `view`. */
export function renderWindow(view: BackfillView): RenderResult {
  return render(createElement(WindowOf, { view }));
}
