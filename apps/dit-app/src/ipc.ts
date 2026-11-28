/**
 * What the dit app's Rust side tells the panel, and what the panel can ask of it. Written by hand, and held to the
 * Rust types by `fixtures/snapshot.json`: a test on each side reads that file, so a field changed in one place and
 * not the other fails a test, not a user.
 */

import type { BackfillCommands } from "./backfill-ipc";

/** The `dit://state` event's name; its payload is a whole {@link Snapshot}. */
export const STATE_EVENT = "dit://state";

/**
 * The URL of a hub image in the app's `dit-art` scheme: Rust fetches `/static/<assetPath>` from the hub with the
 * sign-in's token, which never reaches the webview. `assetPath` is the path after `/static/`; `width`, when given,
 * asks the hub for that resized variant. The response allows any origin, so a canvas may read the pixels of an image
 * loaded with `crossOrigin="anonymous"`. A failure of any kind is a 404 with no body.
 */
export function artUrl(assetPath: string, width?: number): string {
  const path = assetPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const query = width === undefined ? "" : `?w=${width}`;
  return `dit-art://localhost/static/${path}${query}`;
}

export type AuthState =
  /** No sign-in stored. */
  | "signed-out"
  /** The device grant is waiting on the person; `pending` says what to enter. */
  | "signing-in"
  | "signed-in"
  /** The hub refused the stored sign-in. */
  | "revoked"
  /** The Keychain would not give the token up. */
  | "keychain-locked";

export type Auth = {
  state: AuthState;
  /** The hub the machine signs in to; null before one is chosen. */
  host: string | null;
  /** While `signing-in`: the code and address of the grant. */
  pending: { userCode: string; verificationUri: string } | null;
};

export type Machine = {
  /** The name this machine beats as; null until it is registered. */
  name: string | null;
  /** The name the hub refused (another of the account's machines has it); null when none was refused. */
  refused: string | null;
};

/** Why nothing reaches the hub, when nothing does. */
export type Connection = "online" | "offline" | "no-hub" | "refused";

export type OpenTrack = {
  id: number;
  title: string;
};

export type OpenSet = {
  /** The set file's path. */
  path: string;
  /** The file's name without its extension: what the panel calls the set. */
  name: string;
  /** The tracked repo folder it is in; null when dit tracks none there. */
  repo: string | null;
  branch: string | null;
  /** Which witness named it: the script, Live's log, its window title or the newest save. */
  signal: "script" | "log" | "title" | "saves";
  /** The set's page on the instance, for `open_web`; null until a push has made the set a session there. */
  webPath: string | null;
  /** The track the set's hub session is linked to; null when unassigned. */
  track: OpenTrack | null;
};

/** A track of a set, as the DAW reports it: `diffStructure` and the skyline take this shape. */
export type StructureTrack = {
  kind: "audio" | "midi" | "return" | "group" | "master" | "other";
  name: string;
  /** The device names on the track, in chain order. */
  devices: string[];
  /** The DAW's own id for the track; present with a track that can sit in a group. */
  id?: number;
  /** The id of the group track that holds this one. */
  groupId?: number;
  color?: string;
};

export type SetStructure = {
  tracks: StructureTrack[];
  clips?: { audio: number; midi: number };
  scenes?: number;
  plugins?: Record<string, { host: string; manufacturer?: string }>;
  truncated?: boolean;
};

/** What a save says of its set: the shape `diffStructure`, `diffSaves` and `SetSkyline` read (`SaveMeta`). */
export type SetMeta = {
  tempo: string | null;
  timeSignature: string | null;
  rootNote: string | null;
  scale: string | null;
  tracksCount: number | null;
  scenesCount: number | null;
  dawVersion: string | null;
  samplePaths: string[] | null;
  structure: SetStructure | null;
};

export type PushDot = "pending" | "pushing" | "pushed";

export type SaveRow = {
  /** The save's object id. */
  id: string;
  /** Epoch milliseconds the file was saved. */
  at: number;
  file: string;
  unreadable: boolean;
  push: PushDot;
  /** What the save says of the set; null for an unreadable save. */
  meta: SetMeta | null;
};

export type LastCommit = { message: string; at: number };

/** The open set's head commit, which also says whether the hub has it. */
export type HeadCommit = LastCommit & { push: PushDot };

/** One part of the suggested commit message (`dit-core`'s `summary_clauses`, the cli's own wording). */
export type Clause = {
  kind:
    | "tracks"
    | "rename"
    | "devices"
    | "tempo"
    | "timeSignature"
    | "key"
    | "clips"
    | "scenes"
    | "samples"
    | "dawVersion"
    | "trackEdit"
    | "section"
    | "sampleBytes"
    | "more";
  text: string;
};

/** The set's cover on the hub: a path under `/static/`, for `artUrl`, and the accent its pixels give. */
export type Artwork = {
  assetPath: string;
  accentHue: number | null;
  accentChroma: number | null;
};

/** A track the hub holds that the set may be. `track` is its id as a decimal string, for `propose_track`. */
export type TrackChoice = { label: string; track: string };

/** "Which track is this?": the hub's tracks whose titles match the set's name or its folder's, best first. */
export type TrackProposal = {
  choices: TrackChoice[];
  /** The title a new track would have: the folder's name without " Project". Pass `"new"` as the `track`. */
  newTrack: string;
};

/** A `propose_track` `track` that makes a new track titled {@link TrackProposal.newTrack}. */
export const NEW_TRACK = "new";

/** How far the current push burst is: the repos pushed of the repos wanted since the hub was last caught up. */
export type PushProgress = { done: number; total: number };

export type PushState = {
  state: "idle" | "pushing" | "waiting" | "failed";
  /** Repos with something waiting to be pushed. */
  pending: number;
  /** The hub's words for `waiting` and `failed`. */
  message: string | null;
  /** Set while `state` is `pushing`. */
  progress: PushProgress | null;
};

export type ScriptState = {
  /** `live-not-found`: Live is not installed on this computer, so the script has nowhere to go. */
  state: "not-installed" | "installed" | "connected" | "live-not-found";
  /** The Live version that said hello while `connected`. */
  live: string | null;
  /** The folder the script is installed in; null while it is not installed. */
  path: string | null;
};

export type RepoRow = {
  path: string;
  name: string;
  /** Set when the folder could not be opened: moved, deleted, a drive not mounted. */
  unreachable: string | null;
  /** Another writer holds the repo's lock: "waiting for repo". */
  busy: boolean;
  /** The repo's newest commit; null when it has none. */
  lastCommit: LastCommit | null;
  /** Epoch milliseconds of the repo's newest save or commit; null when it has neither. */
  lastActiveAt: number | null;
  /** The repo's page on the instance, for `open_web`; null until a push has bound it. */
  webPath: string | null;
};

/** A hub project a tracked folder can be added to. */
export type HubProject = { id: number; name: string };

export type AdoptOffer = {
  folder: string;
  set: string;
  /** The folder's name. */
  name: string;
  /** How many sets of the DAW the folder holds. */
  setCount: number;
  /** The sync service the folder sits in ("Dropbox", "iCloud Drive"), null when it is in none. */
  syncedBy: string | null;
  /** The projects of the signed-in account; empty when none could be read. */
  projects: HubProject[];
  /** The project last tracked into; null when none was, or it is gone. */
  projectId: number | null;
};

/** Where one set of an adopted folder stands: its first save is being recorded, or is recorded. */
export type AdoptingSet = { name: string; state: "saving" | "saved" };

/** A folder the person just chose to track, while the first saves of its sets are recorded. */
export type Adopting = {
  folder: string;
  /** The folder's name. */
  name: string;
  setCount: number;
  /** The sets found in the folder, each saving until its first save lands. */
  sets: AdoptingSet[];
};

export type Permissions = { screenRecording: boolean };

export type Settings = {
  /** The accelerator that shows the panel, e.g. "Alt+Shift+D"; null when none is set. */
  shortcut: string | null;
  /** Why `shortcut` is not registered (another app holds it); null when it is, or when none is set. */
  shortcutError: string | null;
  maxUploadMb: number;
  watchRoots: string[];
  excluded: string[];
  /** Whether the app starts at login: the OS's login item, read each time. */
  autostart: boolean;
  /** The configured machine name; the computer's name until one is chosen. */
  machineName: string;
  /** Where `dit` is linked on the PATH (`/usr/local/bin/dit`) once it points at this app's cli; null before. */
  cliInstalled: string | null;
  /** What the render watcher never looks in, whatever the person says: names and kinds of name. Read-only. */
  builtInExcluded: string[];
  /** Files marked "Not a bounce", each removable (`forget_rejection`). The name and folder are known only while the
   * ledger still holds a render of the file. */
  rejectedFiles: RememberedFile[];
  /** Folders marked "Never here", each removable (`forget_never_here`). */
  neverHereFolders: string[];
  /** The user's home folder, for `~/` shortening and naming the default watch scope. */
  home: string;
  /** The running app version. */
  appVersion: string;
};

/** A file the person said "Not a bounce" to; the ledger remembers it by `fingerprint`. */
export type RememberedFile = {
  fingerprint: string;
  name: string | null;
  folder: string | null;
};

/**
 * Where a render stands: `waiting` is the minute it is held before a card (no card is shown for it), `proposed` asks
 * for a decision, `uploading` has progress, `queued-offline` waits for the hub, `added` is a version of its track,
 * `over-limit` has no file under the size limit. A rejected render has no card.
 */
export type RenderState =
  | "waiting"
  | "proposed"
  | "uploading"
  | "queued-offline"
  | "added"
  | "over-limit";

/** One file of a render: an absolute path and its size in bytes. */
export type RenderFile = { path: string; size: number };

/** How much of the uploaded file the hub has received. */
export type RenderProgress = { sent: number; total: number };

/** A set of the same repo, as a hub session, that a render could be added to instead ("Not this set"). */
export type RenderSet = { sessionId: number; name: string };

/** The kinds of reason a card words, in the order it words them: "named like the set · in its folder · 4 min after your last save". */
export type ReasonKinds = {
  named: boolean;
  inFolder: boolean;
  nearSave: boolean;
};

/** One render as its card shows it. `id` is the engine's number: it comes back to `accept_render`/`reject_render`. */
export type RenderCard = {
  id: number;
  /** The stem the files share. */
  name: string;
  state: RenderState;
  files: RenderFile[];
  /** How many renders it was proposed with when it is one of a batch. */
  batch: number | null;
  /** The index in `files` of the file that is, or was, uploaded. */
  uploadedFile: number | null;
  /** What a pair of formats comes to, e.g. `Mix.mp3 + Mix.wav: will upload Mix.wav`; null for one file. */
  pairNote: string | null;
  /** Present while `state` is `uploading`. */
  progress: RenderProgress | null;
  /** How sure the engine is it is a version of the session's track, 0 to 1. */
  score: number | null;
  /** Why, as sentences. */
  reasons: string[];
  /** The hub session it is proposed for. */
  sessionId: number | null;
  /** What the state alone does not say: why it is not added yet, or the hub's words. */
  message: string | null;
  /** How long the file that is (or would be) uploaded plays, in milliseconds. */
  durationMs: number | null;
  /** The name of the set it matched. */
  set: string | null;
  /** The other sets of the same repo that are sessions on the hub, by name. */
  otherSets: RenderSet[];
  /**
   * How long after the set's nearest save the file was written, in milliseconds; negative when it was before. Null when
   * the engine does not say.
   */
  bouncedAfterMs: number | null;
  /** Why it was offered, by kind. All false when the engine does not say. */
  reasonKinds: ReasonKinds;
};

/**
 * The restore screen's link: what the hub says of the commit. `message`, `set` and `branch` are null until the hub
 * answers; `problem` says why the restore cannot go (the link is not the account's, the set is not tracked here, the
 * hub could not be asked). It stays set through every `restore` state until `cancel_restore`.
 */
export type PendingRestore = {
  commitId: number;
  message: string | null;
  set: string | null;
  /** `restore-` and the commit's first seven hex digits: what the branch field starts with. */
  branch: string | null;
  problem: string | null;
};

/** How far a restore is. `opened.note` says why the DAW did not open the file, when it did not. */
export type RestoreState =
  | { state: "idle" }
  | { state: "fetching"; objects: number }
  | { state: "writing"; file: string }
  | { state: "opened"; file: string; note: string | null }
  /**
   * The restore did not happen. `message` says why, without a name to try. `suggestion` is a free branch name the
   * field can take ("Use restore-a1b2c3d-2"); `existing` is the absolute path of the file that was in the way (the
   * restore never overwrites it), null when a branch of that name was the clash instead.
   */
  | {
      state: "failed";
      message: string;
      suggestion: string | null;
      existing: string | null;
    };

/**
 * Whether a newer release is on offer, and how far taking it is. `failed.message` is the line the menu shows under
 * the offer, which stands to be tried again.
 */
export type UpdateState =
  | { state: "none" }
  | { state: "available"; version: string }
  | { state: "installing"; version: string }
  | { state: "failed"; version: string; message: string };

/**
 * How the backfill run stands, while there is one to say: `running` while it goes (the window's or the cli's), `paused`
 * when it stopped with folders still to do (paused, quit, left by a crash), which the window shows with "Resume".
 */
export type BackfillStanding = { state: "running" | "paused" };

/** The whole of what the panel shows. The Rust side owns it; the panel derives its screen from it. */
export type Snapshot = {
  auth: Auth;
  machine: Machine;
  connection: Connection;
  /** The bar item's title, from the same formatter the bar uses. */
  barTitle: string;
  /** Whether the DAW is running. */
  live: boolean;
  open: OpenSet | null;
  /** Saves since the set's last commit, newest first. */
  saves: SaveRow[];
  /** The open set's head commit; null before the first commit. */
  lastCommit: HeadCommit | null;
  /** Seconds in the open set since its last commit; null when none is counted. */
  timeSinceCommit: number | null;
  /** Whether the set has no commit of the user's yet: the first commit is the one that names it. */
  firstCommit: boolean;
  /** The head commit's save meta: what the skyline is compared against. Null before the first commit. */
  headMeta: SetMeta | null;
  /** The newest save's meta, else the head's: what the set is now. Null when neither has one. */
  latestMeta: SetMeta | null;
  /** The suggested message's parts, head to newest save; empty when nothing changed or the set has no head. */
  clauses: Clause[];
  /** Names of the tracks whose content changed since the head, by part digest: lit even with their devices alone. */
  tracksChanged: string[];
  /** The tracks of the script's latest `tracks` message for the open set; null when it has said none. */
  liveTracks: StructureTrack[] | null;
  /** The commit box's text for the open set, kept in the app until it is committed. */
  draft: string;
  /** The set's cover on the hub; null with no track or no art. */
  artwork: Artwork | null;
  /** Set while the open set's session on the hub has no track and the set has no commit of the user's. */
  trackProposal: TrackProposal | null;
  push: PushState;
  script: ScriptState;
  repos: RepoRow[];
  adoptOffer: AdoptOffer | null;
  /** Every render that is not rejected (and, of the added ones, only the last few of this run), oldest first. */
  renders: RenderCard[];
  permissions: Permissions;
  settings: Settings;
  /** One-line notices the panel shows until they pass (a refused machine name, a file that stayed torn). */
  notices: string[];
  /** A `projammr://dit/checkout/<commit id>` link waiting for the restore screen. */
  pendingRestore: PendingRestore | null;
  /** How far the restore the link names is. */
  restore: RestoreState;
  /** The folder just adopted, while the first saves of its sets are recorded; null otherwise. */
  adopting: Adopting | null;
  /** The newer release the menu offers; `none` in a build without an update feed. */
  update: UpdateState;
  /** The backfill run: the menu's second line under "Bring in projects…". Null with no run, or once every folder is
   * finished. */
  backfill: BackfillStanding | null;
};

/** The settings the panel may write through `set_setting`; the rest of {@link Settings} are read-only host facts. */
export type WritableSettingKey =
  | "shortcut"
  | "maxUploadMb"
  | "watchRoots"
  | "excluded"
  | "autostart"
  | "machineName";

/** A typed `{ key, value }` pair for `set_setting`, tying each writable key to its own value type. */
export type SettingChange = {
  [K in WritableSettingKey]: { key: K; value: Settings[K] };
}[WritableSettingKey];

/** The commands the panel invokes, with their argument objects. Each answers `void` or rejects with a message. */
export type Commands = {
  get_snapshot: { args: undefined; result: Snapshot };
  sign_in: { args: { host: string | null }; result: void };
  cancel_sign_in: { args: undefined; result: void };
  sign_out: { args: undefined; result: void };
  adopt: { args: { folder: string; projectId: number | null }; result: void };
  decline_folder: { args: { folder: string }; result: void };
  /** The menu's "Track a folder…": the adopt offer for a folder chosen with the folder picker, a declined one included. */
  track_folder: { args: { folder: string }; result: void };
  commit: { args: { set: string; message: string }; result: void };
  set_draft: { args: { set: string; message: string }; result: void };
  /** `track` is a {@link TrackChoice}'s `track`, or {@link NEW_TRACK}; it links the set's session to that track on the hub. */
  propose_track: { args: { set: string; track: string }; result: void };
  /** Adds the render as a version of its set's track; `session` (a {@link RenderSet}'s `sessionId`) adds it to that
   * set's track instead: "Not this set". */
  accept_render: {
    args: { id: number; session?: number | null };
    result: void;
  };
  /** Turns the render down: "Not a bounce", or "Never here" for its folder too. There is no per-set rejection. */
  reject_render: {
    args: { id: number; mode: "not-a-bounce" | "never-here" };
    result: void;
  };
  /** Writes the commit as a new branch and opens it in the DAW; `restore` in the snapshot follows it. Rejects with the
   * core's refusal of a bad name, or of a link that cannot be restored. */
  restore: { args: { commitId: number; name: string }; result: void };
  /** The core's refusal of a branch name, as the field shows it while typed; resolves for a name it takes. */
  validate_branch_name: { args: { name: string }; result: void };
  forget_rejection: { args: { fingerprint: string }; result: void };
  forget_never_here: { args: { folder: string }; result: void };
  set_setting: { args: SettingChange; result: void };
  install_script: { args: undefined; result: void };
  install_cli: { args: undefined; result: void };
  request_screen_recording: { args: undefined; result: void };
  open_web: { args: { path: string | null }; result: void };
  /** The menu's and the first-run "Bring in projects…": opens the backfill window, or brings it forward. */
  open_backfill: BackfillCommands["open_backfill"];
  /** The menu's "Update to <version>": downloads the offered release, waits for the app to be idle, installs it and
   * relaunches; `update` in the snapshot follows. Rejects in a build that has no update feed. */
  install_update: { args: undefined; result: void };
  hide_panel: { args: undefined; result: void };
  /** Suppresses panel auto-hide while the native folder picker is open, and restores focus when it closes. */
  set_picking_folder: { args: { picking: boolean }; result: void };
  quit: { args: undefined; result: void };
  resize_panel: { args: { height: number }; result: void };
  /** Lets the webview play this audio file (under a tracked repo or the home folder) through `convertFileSrc`. */
  allow_media: { args: { path: string }; result: void };
  /** Closes the restore screen: lets the link go. A restore that is already running cannot be stopped; it finishes,
   * writes its branch, and the DAW is not asked to open it. */
  cancel_restore: { args: undefined; result: void };
};
