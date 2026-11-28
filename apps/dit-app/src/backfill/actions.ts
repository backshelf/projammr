import { useMemo } from "react";

import type { BackfillTarget } from "../backfill-ipc";
import { call, callBackfill, pickFolders } from "../bridge";
import { describeFailure } from "../use-command";

/** What the window's controls ask of the app. Each resolves once the app has taken the command or refused it. */
export type BackfillActions = {
  /** "Choose folders…": the system's picker, then the roots with what it chose added. */
  chooseRoots: (roots: readonly string[]) => Promise<void>;
  removeRoot: (roots: readonly string[], root: string) => Promise<void>;
  choose: (folder: string) => Promise<void>;
  /** Next, and "Try again" after the hub could not be reached. */
  check: (folders: readonly string[]) => Promise<void>;
  setTarget: (
    folder: string,
    file: string,
    target: BackfillTarget
  ) => Promise<void>;
  setProject: (folder: string, project: number) => Promise<void>;
  applyProjectToAll?: (
    folders: readonly string[],
    project: number
  ) => Promise<void>;
  back: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: (folder: string) => Promise<void>;
  /** The window's own close: leaves what Check made removed, or pauses a run. */
  close: () => Promise<void>;
  /** "Review unmatched sessions": the instance's sessions list, filtered, in the browser. */
  openSessions: (path: string | null) => Promise<void>;
};

/**
 * The window's commands. `report` hears why one was refused (or null when the next one starts), so a refusal is a
 * line in the window rather than an unhandled rejection.
 */
export function useBackfillActions(
  report: (line: string | null) => void
): BackfillActions {
  return useMemo(() => {
    async function send(command: () => Promise<unknown>): Promise<void> {
      report(null);
      try {
        await command();
      } catch (reason) {
        report(describeFailure(reason));
      }
    }

    return {
      chooseRoots: (roots) =>
        send(async () => {
          const picked = await pickFolders();
          const added = picked.filter((path) => !roots.includes(path));
          if (added.length === 0) return;
          await callBackfill("backfill_roots", { roots: [...roots, ...added] });
        }),
      removeRoot: (roots, root) =>
        send(() =>
          callBackfill("backfill_roots", {
            roots: roots.filter((other) => other !== root),
          })
        ),
      choose: (folder) =>
        send(() => callBackfill("backfill_choose", { folder })),
      check: (folders) =>
        send(() => callBackfill("backfill_check", { folders: [...folders] })),
      setTarget: (folder, file, target) =>
        send(() =>
          callBackfill("backfill_set_target", { folder, file, target })
        ),
      setProject: (folder, project) =>
        send(() => callBackfill("backfill_set_project", { folder, project })),
      applyProjectToAll: (folders, project) =>
        send(async () => {
          await Promise.all(
            folders.map((folder) =>
              callBackfill("backfill_set_project", { folder, project })
            )
          );
        }),
      back: () => send(() => callBackfill("backfill_back")),
      start: () => send(() => callBackfill("backfill_start")),
      pause: () => send(() => callBackfill("backfill_pause")),
      resume: () => send(() => callBackfill("backfill_resume")),
      retry: (folder) => send(() => callBackfill("backfill_retry", { folder })),
      close: () => send(() => callBackfill("backfill_close")),
      openSessions: (path) => send(() => call("open_web", { path })),
    } satisfies BackfillActions;
  }, [report]);
}
