import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import {
  BACKFILL_EVENT,
  type BackfillCommands,
  type BackfillView,
} from "./backfill-ipc";
import { STATE_EVENT, type Commands, type Snapshot } from "./ipc";

/** The argument list a command in `Map` takes: none for `args: undefined`, else its argument object. */
type CallArgs<
  Map extends Record<keyof Map, { args: unknown; result: unknown }>,
  K extends keyof Map,
> = Map[K]["args"] extends undefined ? [] : [args: Map[K]["args"]];

/** Invokes one of the app's commands; the arguments and the answer are the ones `Commands` declares. */
export function call<K extends keyof Commands>(
  command: K,
  ...args: CallArgs<Commands, K>
): Promise<Commands[K]["result"]> {
  return invoke<Commands[K]["result"]>(
    command,
    args[0] as Record<string, unknown> | undefined
  );
}

/** Invokes one of the backfill window's commands; the arguments and the answer are `BackfillCommands`'. */
export function callBackfill<K extends keyof BackfillCommands>(
  command: K,
  ...args: CallArgs<BackfillCommands, K>
): Promise<BackfillCommands[K]["result"]> {
  return invoke<BackfillCommands[K]["result"]>(
    command,
    args[0] as Record<string, unknown> | undefined
  );
}

/** The URL the webview plays or shows a local file from, once the app has allowed the path (`allow_media`). */
export function mediaUrl(path: string): string {
  return convertFileSrc(path);
}

/** Calls `handler` with the whole snapshot each time the app pushes one; resolves to the way to stop. */
export function onState(
  handler: (snapshot: Snapshot) => void
): Promise<UnlistenFn> {
  return listen<Snapshot>(STATE_EVENT, (event) => handler(event.payload));
}

/** Calls `handler` with the whole backfill view each time the app pushes one; resolves to the way to stop. */
export function onBackfill(
  handler: (view: BackfillView) => void
): Promise<UnlistenFn> {
  return listen<BackfillView>(BACKFILL_EVENT, (event) =>
    handler(event.payload)
  );
}

/** Calls `handler` each time the panel's window takes key focus, which is each time the panel is shown. */
export function onFocus(handler: () => void): Promise<UnlistenFn> {
  return listen(TauriEvent.WINDOW_FOCUS, () => handler());
}

/** Asks the person for folders in the system's picker; none when they cancel. */
export async function pickFolders(): Promise<string[]> {
  const picked = await open({ directory: true, multiple: true });
  return picked ?? [];
}

/** Asks the person for one folder in the system's picker; null when they cancel. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true });
  return picked ?? null;
}
