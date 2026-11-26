/**
 * The shape of the demo world: every account, project, collection, track,
 * version, session save, comment, note and share link the seed builds, as
 * plain data. Entities refer to each other by `key` (an account by its key, a
 * track by its key within its project), never by a server id, so the whole
 * world can be checked for consistency without a running API.
 */
import type { MemberRole, SavedViewKind } from "@workspace/api/lib/enums";

/** A project's owner is set by creating it; every other role comes by invite. */
export type InviteRole = Exclude<MemberRole, "owner">;

/**
 * The name, on the scale every new project starts with, of each priority the
 * catalogue gives a track or collection. The seed looks the level up by this
 * name in the project it builds.
 */
export const DEMO_PRIORITY_LEVELS = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
} as const;

/** A priority as the catalogue spells it. */
export type DemoPriority = keyof typeof DEMO_PRIORITY_LEVELS;

/** One of the four covers in `fixtures/covers/`. */
export type Cover = "magenta" | "mono" | "sunset" | "teal";

export interface DemoAccount {
  key: string;
  name: string;
  email: string;
  password: string;
}

/** A status the project defines, or one of the three the instance seeds. */
export interface DemoStatus {
  name: string;
  colourHex: string;
  percentage: number;
  description?: string;
}

export interface DemoLabel {
  name: string;
  colourHex: string;
}

export interface DemoReply {
  author: string;
  text: string;
}

export interface DemoComment extends DemoReply {
  replies?: DemoReply[];
}

/** A comment pinned to a moment of one audio version. */
export interface DemoPin extends DemoComment {
  atMs: number;
}

/**
 * One bounce of a track: `file` in the demo audio directory, which
 * `curate.ts` fills from the owner's own files.
 */
export interface DemoVersion {
  file: string;
  /** The file name the upload carries, as a bounce from the producer's machine. */
  name: string;
  durationMs: number;
  pins: DemoPin[];
}

/** A paragraph of lyrics or notes; an empty string is a blank line. */
export type DemoText = string[];

export interface DemoLyrics {
  author: string;
  lines: DemoText;
}

export interface DemoTrack {
  key: string;
  title: string;
  artists: string[];
  status: string;
  priority: DemoPriority;
  explicit?: boolean;
  cover?: Cover;
  labels: string[];
  notes: DemoText;
  /** In upload order; the last one becomes the primary unless `primary` names another. */
  versions: DemoVersion[];
  primary?: number;
  /**
   * `relation` names one of the relation types every new project starts with
   * ("remix", "rework", …); the seed looks the type up by this name in the
   * project it builds.
   */
  relations?: { to: string; relation: string }[];
  comments?: DemoComment[];
  lyrics?: DemoLyrics;
}

export interface DemoCollection {
  key: string;
  title: string;
  cover?: Cover;
  status: string;
  priority: DemoPriority;
  releaseDate?: string;
  labels: string[];
  notes: DemoText;
  /** Track keys in running order. */
  tracks: string[];
  comments?: DemoComment[];
}

/**
 * An earlier save of the session, described against the real set: which of
 * its top-level tracks (groups and ungrouped tracks, each with everything
 * inside it) existed at that save, whether the returns did, the tempo, and
 * which devices were not on their tracks yet. Each is committed, so it closes
 * a commit that also holds the saves since the one before. The saves between
 * one milestone and the next add clips and samples only.
 */
export interface DemoSaveMilestone {
  at: string;
  tempo: number;
  topLevel: string[];
  returns: boolean;
  missingDevices?: Record<string, string[]>;
  /** The message of the commit that holds this save. */
  message: string;
  /** Saves recorded after this milestone and before the next one. */
  saves: number;
}

/**
 * A session, read from a real Ableton set: `curate.ts` parses the set, gives
 * it demo names and writes `sets/<key>.json` into the demo audio directory.
 */
export interface DemoSession {
  key: string;
  track: string;
  main: boolean;
  /** Where the set lives on the producer's machine. */
  localPath: string;
  /** The home directory the set's sample paths are rebased onto. */
  home: string;
  machine: string;
  /** When the set was last saved: its state is the file as parsed. */
  savedAt: string;
  /** The message of the commit that holds the current save. */
  savedMessage: string;
  /** Earlier saves, oldest first. */
  history: DemoSaveMilestone[];
  comments?: DemoComment[];
}

/**
 * A saved table view. The seed turns it into the table's URL query string,
 * resolving the status and label names and the collection key to ids.
 */
export interface DemoSavedView {
  owner: string;
  name: string;
  kind: SavedViewKind;
  /** `column.asc` or `column.desc`, comma-separated. */
  sort?: string;
  group?: string;
  filter?: { status?: string; label?: string; collection?: string };
  shared: boolean;
}

export interface DemoProject {
  key: string;
  name: string;
  owner: string;
  cover?: Cover;
  description: DemoText;
  links: { name: string; url: string }[];
  /** Everyone but the owner, each joining through an invite for that role. */
  members: { account: string; role: InviteRole }[];
  /** Invites nobody has accepted yet. */
  invites: { email: string; role: InviteRole }[];
  statuses: DemoStatus[];
  labels: DemoLabel[];
  tracks: DemoTrack[];
  collections: DemoCollection[];
  sessions: DemoSession[];
  savedViews: DemoSavedView[];
  comments?: DemoComment[];
}

/** A comment a visitor leaves on a share page, without an account. */
export interface DemoGuestComment {
  name: string;
  text: string;
  /** The track whose playing version the comment is pinned to, and where. */
  track?: string;
  atMs?: number;
}

export interface DemoShareLink {
  project: string;
  owner: string;
  entity: { kind: "collection" | "track"; key: string };
  type: "snapshot" | "connected";
  description: string;
  guestComments: DemoGuestComment[];
}

/** A notebook note that is not a track's lyrics. */
export interface DemoNote {
  author: string;
  pinned?: boolean;
  body: DemoText;
}

export interface DemoCatalogue {
  /** The first account is the instance's first sign-up, and so its admin. */
  accounts: DemoAccount[];
  projects: DemoProject[];
  shareLinks: DemoShareLink[];
  notes: DemoNote[];
}
