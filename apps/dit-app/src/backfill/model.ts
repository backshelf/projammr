import type { Formatters } from "@workspace/ui/lib/formatters";

import type {
  BackfillChosen,
  BackfillFolder,
  BackfillFolderDoubt,
  BackfillFolderState,
  BackfillSession,
  BackfillSet,
  BackfillStorage,
  BackfillSummary,
  BackfillTarget,
  BackfillView,
} from "../backfill-ipc";
import type { PickerOption } from "./picker";

/** "1 set", "8 sets"; with `format`, the number in the viewer's grouping ("3,412 saves"). */
function counted(count: number, noun: string, format?: Formatters): string {
  const figure = format ? format.number(count) : String(count);
  return `${figure} ${count === 1 ? noun : `${noun}s`}`;
}

/** The host a line names; the line still reads when the app has no sign-in to name it. */
function hostOf(view: Pick<BackfillView, "host">): string {
  return view.host ?? "the hub";
}

// ---------------------------------------------------------------------------------------------------------------
// Find

/** "8 sets · 2.3 GB · last saved 12 Mar 2024". */
export function folderFacts(
  folder: BackfillFolder,
  format: Formatters
): string {
  const parts = [counted(folder.sets, "set"), format.bytes(folder.bytes, 1)];
  if (folder.newest !== null) {
    parts.push(`last saved ${format.date(folder.newest)}`);
  }
  return parts.join(" · ");
}

/** The folders a person can tick: a folder that is a repo already is listed and left alone. */
export function tickable(folders: readonly BackfillFolder[]): BackfillFolder[] {
  return folders.filter((folder) => !folder.already);
}

/**
 * The paths ticked. Folders are ticked until the person unticks them, so one that turns up while Find is still
 * walking arrives ticked, and a folder that is already a repo can never be.
 */
export function tickedPaths(
  folders: readonly BackfillFolder[],
  unticked: ReadonlySet<string>
): string[] {
  return tickable(folders)
    .filter((folder) => !unticked.has(folder.path))
    .map((folder) => folder.path);
}

/** `unticked` with `path` flipped. */
export function toggled(
  unticked: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(unticked);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** The Find footer's line: the walk's count while it goes, else how many of the folders are ticked. */
export function findLine(
  view: Pick<BackfillView, "searching" | "folders">,
  ticked: number
): string | null {
  if (view.searching) {
    return `Searching… ${counted(view.folders.length, "project")} so far`;
  }
  const available = tickable(view.folders).length;
  return available === 0 ? null : `${ticked} of ${available} ticked`;
}

// ---------------------------------------------------------------------------------------------------------------
// Check

/** What a folder's list row says under its name on Check: its sets and what is in doubt. */
export function checkFacts(folder: BackfillFolder): string {
  const state = folder.state;
  if (state.state === "reading") {
    return `Reading sets · ${state.read} of ${state.of}`;
  }
  if (state.state === "failed") return state.reason;
  return [counted(folder.sets, "set"), ...doubtParts(folder.doubt)].join(" · ");
}

function doubtParts(doubt: BackfillFolderDoubt | null): string[] {
  if (doubt === null) return [];
  const parts: string[] = [];
  if (doubt.unreadable > 0) {
    parts.push(`${doubt.unreadable} couldn't be read`);
  }
  if (doubt.unrecorded > 0) parts.push(`${doubt.unrecorded} left out`);
  if (doubt.syncedBy !== null) parts.push(`synced by ${doubt.syncedBy}`);
  return parts;
}

/** Whether Check is still reading sets: Start has nothing to go on yet. */
export function isReading(folders: readonly BackfillFolder[]): boolean {
  return folders.some((folder) => folder.state.state === "reading");
}

/** The synced-folder warning the panel's adopt screen gives, for the chosen folder's head. */
export function syncWarning(syncedBy: string): string {
  return `This folder is synced by ${syncedBy}. Two computers sharing one repo will corrupt it.`;
}

/** "4 backups". */
export function backupsLabel(copies: number): string {
  return counted(copies, "backup");
}

/** The line under a set that Check could not take whole. */
export function setDoubtLine(set: BackfillSet): string | null {
  if (set.doubt === null) return null;
  if (set.doubt.kind === "unreadable") {
    return "Couldn't read this set. It's stored as it is and read again later.";
  }
  return set.doubt.message ?? "Left out of this run.";
}

/** The storage line in the Check footer. */
export function storageLine(
  storage: BackfillStorage,
  format: Formatters
): string {
  const needs = format.bytes(storage.bytes, 1);
  if (storage.remaining === null) {
    return `Needs ${needs}. No storage limit on this instance.`;
  }
  const left = format.bytes(storage.remaining, 1);
  return storage.bytes > storage.remaining
    ? `These folders need ${needs} and you have ${left} left. Go back (⌘[) to untick folders until they fit.`
    : `Needs ${needs} of your ${left} left.`;
}

/** The two ids a picker's values stand for beside a real track or session. */
const NEW = "new";
/** The value of a track picker that only shows the track a matched session is on. */
const KEPT = "kept";

/** What the pickers of the chosen folder's sets choose among. */
export type Choices = Pick<BackfillChosen, "tracks" | "sessions" | "newTrack">;

/** The tracks of the project, then "New track: <name>". */
function trackOptions(choices: Choices): PickerOption[] {
  return [
    ...choices.tracks.map((track) => ({
      value: String(track.id),
      label: track.title,
    })),
    { value: NEW, label: `New track: ${choices.newTrack}` },
  ];
}

/**
 * The track picker's value and options for a set: a matched session keeps its own track, so the picker only shows
 * it; any other set picks among the project's tracks.
 */
export function trackChoice(
  set: BackfillSet,
  choices: Choices
): { value: string | null; options: PickerOption[]; locked: boolean } {
  const target = set.target;
  if (target?.kind === "session") {
    return {
      value: KEPT,
      options: [{ value: KEPT, label: set.matched?.trackTitle ?? "" }],
      locked: true,
    };
  }
  const options = trackOptions(choices);
  if (target?.kind === "track") {
    return { value: String(target.id), options, locked: false };
  }
  return {
    value: target?.kind === "new-track" ? NEW : null,
    options,
    locked: false,
  };
}

/** "Matches 'science123' on Science". */
function matchLabel(
  session: Pick<BackfillSession, "name" | "trackTitle">
): string {
  return session.trackTitle === null
    ? `Matches '${session.name}'`
    : `Matches '${session.name}' on ${session.trackTitle}`;
}

/** The session picker's options for a set: "New session", then the sessions no other set has taken. */
export function sessionOptions(
  set: BackfillSet,
  choices: Choices
): PickerOption[] {
  return [
    { value: NEW, label: "New session" },
    ...choices.sessions
      .filter(
        (session) => session.takenBy === null || session.takenBy === set.file
      )
      .map((session) => ({
        value: String(session.id),
        label: matchLabel(session),
      })),
  ];
}

/** The session picker's value: the session the set matches, else "New session". */
export function sessionValue(set: BackfillSet): string {
  return set.target?.kind === "session" ? String(set.target.id) : NEW;
}

/** Where a set goes when the track picker chooses `value`. */
export function targetForTrack(
  value: string,
  choices: Choices
): BackfillTarget {
  return value === NEW
    ? { kind: "new-track", name: choices.newTrack }
    : { kind: "track", id: Number(value) };
}

/**
 * Where a set goes when the session picker chooses `value`. A session is a pick of its own; "New session" lands the
 * set on a new session in the track the matched session was on, or on the folder's new track when it had none.
 */
export function targetForSession(
  value: string,
  set: BackfillSet,
  choices: Choices
): BackfillTarget {
  if (value !== NEW) return { kind: "session", id: Number(value) };
  const trackId = set.matched?.trackId ?? null;
  return trackId === null
    ? { kind: "new-track", name: choices.newTrack }
    : { kind: "track", id: trackId };
}

// ---------------------------------------------------------------------------------------------------------------
// Bring in

/** "3.1 of 8.4 GB": the sent figure drops its unit when it is the total's. */
function bytesOf(sent: number, total: number, format: Formatters): string {
  const whole = format.bytes(total, 1);
  const part = format.bytes(sent, 1);
  const unit = whole.slice(whole.lastIndexOf(" "));
  return part.endsWith(unit)
    ? `${part.slice(0, -unit.length)} of ${whole}`
    : `${part} of ${whole}`;
}

/** What a folder's list row says in the run: the state in the words of the spec. */
export function stateLine(
  state: BackfillFolderState,
  view: Pick<BackfillView, "host">,
  format: Formatters
): string | null {
  switch (state.state) {
    case "idle":
    case "checked":
      return null;
    case "reading":
      return `Reading sets · ${state.read} of ${state.of}`;
    case "waiting":
      return "Waiting";
    case "committing":
      return `${state.done} of ${state.of} sets`;
    case "uploading":
      return bytesOf(state.sent, state.of, format);
    case "waiting-for-hub":
      return `Waiting for ${hostOf(view)}`;
    case "done":
      return "Done";
    case "paused":
      return "Paused";
    case "failed":
      return state.reason;
  }
}

/** How far a folder is, 0 to 100, for the line under its row; null when there is nothing to measure. */
export function progressPercent(state: BackfillFolderState): number | null {
  switch (state.state) {
    case "reading":
      return fraction(state.read, state.of);
    case "committing":
      return fraction(state.done, state.of);
    case "uploading":
      return fraction(state.sent, state.of);
    case "done":
      return 100;
    default:
      return null;
  }
}

function fraction(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.min(100, Math.round((part / whole) * 100));
}

export type FolderFigures = {
  committed: string;
  saves: string;
  uploaded: string;
};

const NOT_YET = "–";

/** The chosen folder's three figures in the run: sets committed, saves stored and data uploaded. */
export function folderFigures(
  folder: BackfillFolder,
  totals: { saves: number; sets: number; bytes: number } | null,
  format: Formatters
): FolderFigures {
  const state = folder.state;
  const committed =
    state.state === "committing"
      ? `${state.done} of ${state.of}`
      : state.state === "uploading" || state.state === "done"
        ? format.number(totals?.sets ?? folder.sets)
        : NOT_YET;
  return {
    committed,
    saves: totals === null ? NOT_YET : format.number(totals.saves),
    uploaded:
      state.state === "uploading"
        ? bytesOf(state.sent, state.of, format)
        : state.state === "done" && totals !== null
          ? format.bytes(totals.bytes, 1)
          : NOT_YET,
  };
}

/** The Bring in footer's line. */
export function runLine(view: BackfillView): string | null {
  if (view.run?.paused) {
    return "Paused. Resume to carry on where it stopped.";
  }
  const folders = view.run?.folders ?? [];
  if (folders.length === 0) return null;
  const done = folders.filter((folder) => folder.state.state === "done").length;
  return `${done} of ${counted(folders.length, "folder")} done`;
}

/** The folders of the run that failed: they stay listed, with their reasons, when the run is over. */
export function failedFolders(
  folders: readonly BackfillFolder[]
): (BackfillFolder & { state: { state: "failed"; reason: string } })[] {
  return folders.filter(
    (
      folder
    ): folder is BackfillFolder & {
      state: { state: "failed"; reason: string };
    } => folder.state.state === "failed"
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Done

/** "Your history goes back to March 2019: 3,412 saves across 266 sets in 41 projects." */
export function readout(summary: BackfillSummary, format: Formatters): string {
  const counts = `${counted(summary.saves, "save", format)} across ${counted(summary.sets, "set", format)} in ${counted(summary.projects, "project", format)}`;
  return summary.firstSave === null
    ? `${capitalised(counts)}.`
    : `Your history goes back to ${format.monthYear(summary.firstSave)}: ${counts}.`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The live region

/**
 * What a screen reader hears when the folders change: the first folder that finished or failed since `before`, and
 * nothing for a count that only moved. Null when nothing of the kind happened.
 */
export function announcement(
  before: ReadonlyMap<string, BackfillFolderState["state"]>,
  folders: readonly BackfillFolder[]
): string | null {
  for (const folder of folders) {
    const was = before.get(folder.path);
    const state = folder.state;
    if (was === undefined || was === state.state) continue;
    if (state.state === "done") return `${folder.name}: done`;
    if (state.state === "failed") {
      return `${folder.name}: failed. ${state.reason}`;
    }
  }
  return null;
}

/** Each folder's state kind, the key `announcement` compares against. */
export function stateKinds(
  folders: readonly BackfillFolder[]
): Map<string, BackfillFolderState["state"]> {
  return new Map(folders.map((folder) => [folder.path, folder.state.state]));
}
