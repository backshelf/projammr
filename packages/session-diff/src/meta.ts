/**
 * The parts of a save's recorded metadata the diff reads. Declared here, not
 * taken from `@workspace/api`'s generated types: the server runs this package
 * too and the generated types are built from the server, so the dependency
 * would loop. The API's `SaveMeta` is assignable to this one.
 */

/** A track of a set: what it is called, what is on it, and where it sits. */
export type SessionTrack = {
  kind: "audio" | "midi" | "return" | "group" | "master" | "other";
  name: string;
  devices: string[];
  /** The DAW's own id for this track, so a grouped track can name its parent. */
  id?: number;
  /** The `id` of the group track this one sits in; absent at the top level. */
  groupId?: number;
  /** The colour the DAW shows the track in, as `#rrggbb`. */
  color?: string;
};

/** A set's parsed shape: its tracks, what is on each, and its clip and scene counts. */
export type SessionStructure = {
  tracks: SessionTrack[];
  clips?: { audio: number; midi: number };
  scenes?: number;
  /** The third-party devices among the chains, keyed by display name. */
  plugins?: Record<string, { host: string; manufacturer?: string }>;
  truncated?: boolean;
};

/** What one save of a session looked like: the DAW-derived fields a save records. */
export type SaveMeta = {
  tempo?: string | null;
  timeSignature?: string | null;
  rootNote?: string | null;
  scale?: string | null;
  tracksCount?: number | null;
  scenesCount?: number | null;
  dawVersion?: string | null;
  structure?: SessionStructure | null;
  samplePaths?: string[] | null;
};
