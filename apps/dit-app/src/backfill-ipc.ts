/**
 * What the dit app's Rust side tells the backfill window, and what the window can ask of it. Written by hand, and held
 * to the Rust types by `fixtures/backfill.json`: a test on each side reads that file, so a field changed in one place
 * and not the other fails a test, not a user.
 *
 * The run belongs to Rust, not to the window: the folders found, the sets read, the person's corrections and the
 * run itself all live there, so closing the window loses nothing but a Find or Check in progress. The view is sent
 * whole on every change (at most ten times a second), never merged.
 */

/** The `dit://backfill` event's name; its payload is a whole {@link BackfillView}. */
export const BACKFILL_EVENT = "dit://backfill";

/**
 * Which of the window's steps the app is in. `bring-in` is a run that goes, is paused or was stopped (the window
 * shows "Resume"); `done` is a run with every folder finished (done or failed).
 */
type BackfillStep = "find" | "check" | "bring-in" | "done";

/** Where a folder stands, in whichever step it is shown. */
export type BackfillFolderState =
  /** Found and listed; Check has not read it. */
  | { state: "idle" }
  /** Check is reading its sets into its `.dit/`: `read` of `of`. */
  | { state: "reading"; read: number; of: number }
  /** Check has read it. */
  | { state: "checked" }
  /** In the run, not started. */
  | { state: "waiting" }
  /** The run is recording and committing its sets: `done` of `of`. */
  | { state: "committing"; done: number; of: number }
  /** The run is sending its objects: `sent` of `of` bytes. */
  | { state: "uploading"; sent: number; of: number }
  /** The hub can't be reached or is busy; the folder carries on when it answers. */
  | { state: "waiting-for-hub" }
  | { state: "done" }
  /** The run stopped while the folder was being brought in. */
  | { state: "paused" }
  /** The folder could not be read (Check) or brought in (the run), in words to show; "Try again" is `backfill_retry`. */
  | { state: "failed"; reason: string };

/** What Check found in a folder that makes it doubtful. */
export type BackfillFolderDoubt = {
  /** Sets with a save (or a `Backup/` copy) dit could not decode: stored whole and read again later. */
  unreadable: number;
  /** Sets Check could not record now: left out of the run. */
  unrecorded: number;
  /** The sync service the folder sits in ("iCloud Drive"), which can disturb files dit has open. */
  syncedBy: string | null;
};

/** One ` Project` folder, as the list on the left shows it. */
export type BackfillFolder = {
  /** The folder's canonical path. */
  path: string;
  name: string;
  /** The name without its " Project": what the list and the run title the folder by. */
  title: string;
  /** Sets in the folder. */
  sets: number;
  /** Size on disk, bytes; dit's own `.dit/` is not counted. */
  bytes: number;
  /** When the newest save over the sets and their copies was made, milliseconds since the epoch; null with no set. */
  newest: number | null;
  /** The folder is a repo already (listed, not tickable): "Already in dit". */
  already: boolean;
  state: BackfillFolderState;
  /** Null until Check has read the folder, and after it when nothing is in doubt. */
  doubt: BackfillFolderDoubt | null;
};

/** Where a set goes on the hub: into an existing session, or into a new session on a track (existing or new). */
export type BackfillTarget =
  | { kind: "session"; id: number }
  | { kind: "track"; id: number }
  | { kind: "new-track"; name: string };

/** The existing session a set is matched to, with the track the session is on. */
type BackfillMatch = {
  sessionId: number;
  name: string;
  trackId: number | null;
  trackTitle: string | null;
};

/** Why a set is in doubt after Check. */
type BackfillSetDoubt = {
  /** `unreadable`: stored whole, read again later. `unrecorded`: left out; `message` says why. */
  kind: "unreadable" | "unrecorded";
  message: string | null;
};

/** One set of the chosen folder. Before Check only `file`, `name` and `copies` are known. */
export type BackfillSet = {
  /** The set file's path: the key `backfill_set_target` takes. */
  file: string;
  /** The file's name without its extension. */
  name: string;
  /** The set's id in the folder's repo; null before Check, and for a set Check could not record. */
  setId: string | null;
  /** `Backup/` copies. */
  copies: number;
  /** Saves on the set's `main` branch once Check has read it; null before. */
  saves: number | null;
  doubt: BackfillSetDoubt | null;
  /** Where the set goes now (the proposal, or the person's change); null before Check and for an unrecorded set. */
  target: BackfillTarget | null;
  /** The session `target` names, when it names one; null for a new session. */
  matched: BackfillMatch | null;
};

/** A track of the chosen folder's project. */
type BackfillTrack = { id: number; title: string };

/** A session of the chosen folder's project that no repo holds: what a set can be matched to. */
export type BackfillSession = {
  id: number;
  name: string;
  trackId: number | null;
  trackTitle: string | null;
  /** The file of the set in this folder that is matched to it now; null when it is free to pick. A session is
   * matched to at most one set. */
  takenBy: string | null;
};

/** An account project a folder can go into. */
type BackfillProject = { id: number; name: string };

/** The chosen folder, on the right. */
export type BackfillChosen = {
  folder: string;
  name: string;
  /** The project the folder goes into; null before Check. */
  project: number | null;
  /** The project's tracks: the track picker's items; empty before Check. */
  tracks: BackfillTrack[];
  /** The project's sessions no repo holds: the session picker's items; empty before Check. */
  sessions: BackfillSession[];
  /** The name "New track: <name>" offers: the folder's name without " Project". */
  newTrack: string;
  sets: BackfillSet[];
};

/** What the folders would add to the hub's storage, from the objects Check recorded. */
export type BackfillStorage = {
  /** Bytes the hub does not already hold. */
  bytes: number;
  /** The room left; null with no cap ("No storage limit on this instance."). */
  remaining: number | null;
};

/** What a finished folder holds. */
type BackfillTotals = {
  /** The oldest save's time, milliseconds since the epoch. */
  firstSave: number | null;
  saves: number;
  sets: number;
  bytes: number;
};

/** How the run stands. The state file says; this is what it said when the view was made. */
type BackfillRun = {
  /** A run goes now, here or in another process. */
  running: boolean;
  /** The run stopped on request (the footer says "Paused. Resume to carry on where it stopped."). */
  paused: boolean;
  /** One entry per folder of the plan, in run order, newest first. */
  folders: {
    path: string;
    state: BackfillFolderState;
    totals: BackfillTotals | null;
  }[];
};

/** What the folders that are done add up to: "Your history goes back to March 2019: 3,412 saves across 266 sets in 41 projects." */
export type BackfillSummary = {
  firstSave: number | null;
  saves: number;
  sets: number;
  projects: number;
};

/** The whole of what the backfill window shows. The Rust side owns it; the window derives its screen from `step`. */
export type BackfillView = {
  step: BackfillStep;
  /** The instance's host, for "Can't reach <host>" and "Waiting for <host>"; null with no sign-in. */
  host: string | null;
  /** The roots Find searches under. */
  roots: string[];
  /** Find is still walking: "Searching… <folders.length> projects so far". */
  searching: boolean;
  /** The list on the left, newest first. On Check it is the folders that were ticked; on Bring in and Done, the run's. */
  folders: BackfillFolder[];
  chosen: BackfillChosen | null;
  /** The projects the folder picker offers; empty before Check. */
  projects: BackfillProject[];
  /** Null before Check has asked the hub, and while it asks. */
  storage: BackfillStorage | null;
  /** The line when the hub could not answer Check ("Can't reach <host> to check your sessions."); Start is off. */
  hubError: string | null;
  /** Start may be pressed: Check is done, the hub answered, the storage fits and no session is claimed twice. */
  canStart: boolean;
  run: BackfillRun | null;
  /** What the done folders add up to, once any folder is done; null before. */
  summary: BackfillSummary | null;
  /** The path on the instance of the sessions list filtered to those not in dit (`open_web`'s argument), for the
   * Done readout's "See sessions not in dit"; null until a folder is done. */
  sessionsPath: string | null;
  /** The line a run's own refusal leaves (a second run on this machine, a sign-in the hub refused). */
  error: string | null;
};

/**
 * The commands the window invokes, with their argument objects. Each answers `void` or rejects with a line to show
 * under the control that sent it; the new view arrives as a `dit://backfill` event, not as an answer.
 */
export type BackfillCommands = {
  /** The panel's "Bring in projects…": opens the window, or brings it forward. Opens on Find, or on the run that
   * exists (paused, stopped or going). */
  open_backfill: { args: undefined; result: void };
  get_backfill: { args: undefined; result: BackfillView };
  /** Replaces the roots (the picker added one, a chip was removed) and searches again. Rejects for a path that is
   * not a folder. */
  backfill_roots: { args: { roots: string[] }; result: void };
  /** Searches the current roots again, stopping a search in flight. */
  backfill_find: { args: undefined; result: void };
  /** Shows the folder's sets on the right (a folder of `folders`). */
  backfill_choose: { args: { folder: string }; result: void };
  /** Next: reads the sets of the ticked folders into their `.dit/` and asks the hub for proposals and storage. Also
   * "Try again" after a `hubError`. The ticks are the window's; Rust keeps only what it checked last. */
  backfill_check: { args: { folders: string[] }; result: void };
  /** Changes where one set of a folder goes. Rejects when a session is already matched to another set. */
  backfill_set_target: {
    args: { folder: string; file: string; target: BackfillTarget };
    result: void;
  };
  /** Moves a folder into another project: reads that project's sessions and tracks and proposes its sets again. */
  backfill_set_project: {
    args: { folder: string; project: number };
    result: void;
  };
  /** Back: Check (or a run that has not begun) goes back to Find and removes the `.dit/` folders Check made. */
  backfill_back: { args: undefined; result: void };
  /** Start: brings the checked folders in. Rejects unless `canStart`. */
  backfill_start: { args: undefined; result: void };
  backfill_pause: { args: undefined; result: void };
  /** Carries on the stopped run where it was. */
  backfill_resume: { args: undefined; result: void };
  /** Try again for a failed folder: its sets are proposed again (a session another run took becomes a new session)
   * and the run starts again. Every folder that is not done runs again with it. */
  backfill_retry: { args: { folder: string }; result: void };
  /** Closes the window: on Find or Check it removes what Check made, on Bring in it pauses the run. The same as
   * the red button. */
  backfill_close: { args: undefined; result: void };
};
