import { z } from "zod";
import { defineGroup, defineSetting, INSTANCE_ONLY } from "../define.js";

type Allowance = { burst: number; perMinute: number };

type Bucket = Allowance & {
  /** What the bucket is called on its rows. */
  label: string;
  /** What it meters, and per whom, as its rows describe it. */
  meters: string;
  /**
   * The least it may be set to, so that no setting can lock one person out of
   * signing in or loading a page.
   */
  floor: Allowance;
};

/**
 * Every rate bucket the server meters, keyed by the name its tokens are filed
 * under: what it meters, its default allowance and its floor. `burst` calls
 * may come at once, and the allowance refills at `perMinute`. The server's
 * `rateLimit` and `spendToken` (`middleware/rate-limit.ts`) read a bucket's
 * allowance from the instance policy on every call; why each route is metered
 * is said where it mounts its bucket.
 */
export const RATE_BUCKETS = {
  /**
   * Moving an entity rewrites a whole reachability set across two projects in
   * one transaction. The three kinds share this bucket: what is being metered
   * is the work, not which endpoint asked for it.
   */
  moves: {
    label: "Moves",
    meters: "Moving one collection, track or session to another project",
    burst: 10,
    perMinute: 20,
    floor: { burst: 1, perMinute: 1 },
  },
  /**
   * A bulk move rewrites a whole reachability set for every id in the
   * selection in one transaction, so it draws on its own, tighter allowance
   * rather than `moves`: one bulk move should not starve the single moves
   * sharing that bucket, and vice versa.
   */
  "bulk-moves": {
    label: "Bulk moves",
    meters: "Moving a whole selection at once",
    burst: 5,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  /** Re-links every session in one statement per move; a flood of them is a flood of writes. */
  "session-moves": {
    label: "Session moves",
    meters: "Moving sessions to other tracks",
    burst: 10,
    perMinute: 20,
    floor: { burst: 1, perMinute: 1 },
  },
  /**
   * A backfill probes every audio file in the project, so it is metered far
   * more tightly than an ordinary write — loosely enough that an admin can
   * retry.
   */
  "audio-backfill": {
    label: "Audio backfills",
    meters: "Reading every audio file in a project again",
    burst: 5,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  /**
   * The three buckets on the share page's guest-facing routes, sized for one
   * reader loading a page versus one flooding it: a share's details and its
   * comment thread are ordinary reads, streaming audio bytes and covers is
   * heavier per call, and posting a comment is a write. The read and stream
   * floors leave one reader a whole page load.
   */
  "share-read": {
    label: "Share page reads",
    meters: "A share page's details and comments, per visitor",
    burst: 60,
    perMinute: 120,
    floor: { burst: 10, perMinute: 20 },
  },
  "share-stream": {
    label: "Share page audio",
    meters: "The audio and covers a share page streams, per visitor",
    burst: 20,
    perMinute: 60,
    floor: { burst: 10, perMinute: 20 },
  },
  "share-comment": {
    label: "Share page comments",
    meters: "Comments posted on a share page, per visitor",
    burst: 5,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  "email-change": {
    label: "Email changes",
    meters: "Changing an account's email address",
    burst: 5,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  /** An open note autosaves as it is typed in, so its floor leaves room for a burst of saves. */
  "notes-save": {
    label: "Note saves",
    meters: "Saving a note as it is typed in",
    burst: 60,
    perMinute: 120,
    floor: { burst: 10, perMinute: 20 },
  },
  "lyrics-analyze": {
    label: "Lyrics analysis",
    meters: "Rhyme and syllable help while lyrics are written",
    burst: 60,
    perMinute: 120,
    floor: { burst: 10, perMinute: 20 },
  },
  /** The settings hub saves a row as it is edited (debounced), like a note. */
  "settings-write": {
    label: "Settings changes",
    meters: "Saving a setting as it is edited",
    burst: 60,
    perMinute: 120,
    floor: { burst: 10, perMinute: 20 },
  },
  "image-upload": {
    label: "Image uploads",
    meters: "Uploading covers, avatars and brand images",
    burst: 100,
    perMinute: 300,
    floor: { burst: 5, perMinute: 10 },
  },
  upload: {
    label: "Uploads",
    meters: "Uploading audio and attachments",
    burst: 100,
    perMinute: 300,
    floor: { burst: 5, perMinute: 10 },
  },
  "repo-objects": {
    label: "Repo pushes",
    meters: "Uploading the packs of objects a dit push sends",
    burst: 100,
    perMinute: 300,
    floor: { burst: 5, perMinute: 10 },
  },
  /** A zip streams every object of a set and its samples, so a few at once is plenty for a person. */
  "repo-archive": {
    label: "Repo archives",
    meters: "Downloading a commit or a repository as a zip",
    burst: 10,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  convert: {
    label: "Conversions",
    meters: "Converting audio to another format",
    burst: 10,
    perMinute: 10,
    floor: { burst: 1, perMinute: 1 },
  },
  "oauth-register": {
    label: "Agent registrations",
    meters: "An MCP client registering itself, per network address",
    burst: 5,
    perMinute: 5,
    floor: { burst: 1, perMinute: 1 },
  },
  /**
   * The pre-auth buckets are keyed by the caller's address, which every
   * caller behind one untrusted proxy shares; their floors leave a sign-in
   * with a mistyped password or two.
   */
  "auth-signin": {
    label: "Sign-ins",
    meters: "Signing in with a password, per network address",
    burst: 10,
    perMinute: 20,
    floor: { burst: 3, perMinute: 3 },
  },
  "auth-signup": {
    label: "Sign-ups",
    meters: "Creating an account, per network address",
    burst: 5,
    perMinute: 5,
    floor: { burst: 2, perMinute: 2 },
  },
  "guest-signin": {
    label: "Guest sign-ins",
    meters: "A share page's guests signing in, per network address",
    burst: 5,
    perMinute: 10,
    floor: { burst: 2, perMinute: 2 },
  },
  /**
   * Starting a device sign-in writes a row for any caller, and looking a
   * code up is how a pending one is claimed, so both draw on this bucket:
   * keyed by the signed-in account when there is one, else by address. Polling
   * for the token is not metered here — a login polls every few seconds for
   * the code's whole lifetime, and the device code it presents is the secret.
   */
  "device-signin": {
    label: "Device sign-ins",
    meters: "Starting a sign-in from a device and looking its code up",
    burst: 5,
    perMinute: 10,
    floor: { burst: 2, perMinute: 2 },
  },
  /** An agent's tool calls, keyed per account; one exchange can make a dozen. */
  mcp: {
    label: "Agent tool calls",
    meters: "An AI agent's MCP tool calls, per account",
    burst: 60,
    perMinute: 120,
    floor: { burst: 10, perMinute: 20 },
  },
  /**
   * A machine's beat, keyed by the machine rather than the user, so one of a
   * user's machines beating too fast cannot starve the others. A machine beats
   * every 30 s and on each change it reports; the default leaves room for a
   * burst and a reconnect, not for a loop, and the floor keeps the 30 s beat.
   */
  "device-heartbeat": {
    label: "Machine beats",
    meters: "A machine reporting in, per machine",
    burst: 10,
    perMinute: 10,
    floor: { burst: 3, perMinute: 3 },
  },
} as const satisfies Record<string, Bucket>;

export type RateBucketName = keyof typeof RATE_BUCKETS;

/** Every bucket's name, in the table's order. */
export const RATE_BUCKET_NAMES = Object.keys(RATE_BUCKETS) as RateBucketName[];

/** A bucket's allowance: a whole number of calls, no lower than its floor. */
const allowance = (floor: number) =>
  z
    .number()
    .int()
    .min(floor, { error: `At least ${floor}: lower could lock people out` });

/** A bucket's two keys, `<bucket>.burst` and `<bucket>.perMinute`. */
const bucketSettings = (name: RateBucketName) => {
  const { label, meters, burst, perMinute, floor } = RATE_BUCKETS[name];
  const keywords = ["rate limit", "throttle", "429", name, label];
  return [
    defineSetting({
      ...INSTANCE_ONLY,
      key: `instance-rate-limits.${name}.burst`,
      group: "instance-rate-limits",
      label: `${label}, in a row`,
      description: `${meters}: how many one caller can make in a row before being slowed.`,
      keywords,
      schema: allowance(floor.burst),
      default: burst,
      control: { kind: "number", min: floor.burst, step: 1, unit: "calls" },
      audience: "admin",
    }),
    defineSetting({
      ...INSTANCE_ONLY,
      key: `instance-rate-limits.${name}.perMinute`,
      group: "instance-rate-limits",
      label: `${label}, per minute`,
      description: `${meters}: how many more one caller gets back each minute.`,
      keywords,
      schema: allowance(floor.perMinute),
      default: perMinute,
      control: { kind: "number", min: floor.perMinute, step: 1, unit: "calls" },
      audience: "admin",
    }),
  ];
};

export const group = defineGroup({
  id: "instance-rate-limits",
  section: "instance",
  label: "Rate limits",
  description:
    "How fast one caller may repeat each kind of request before being asked to wait. Each has a floor that keeps everyone able to sign in and load a page.",
  order: 900,
  advanced: true,
});

export const settings = RATE_BUCKET_NAMES.flatMap(bucketSettings);
