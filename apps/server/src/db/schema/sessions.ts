import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import { z } from "zod";
import {
  type BlockDocument,
  baseSchema,
  baseSchemaIgnores,
  blockDocumentSchema,
  scopeIgnores,
} from "./base.js";
import { priorityLevels } from "./priority-levels.js";
import { projects } from "./projects.js";
import { branches, repos } from "./repos.js";
import {
  MAX_SAMPLES,
  type SessionSample,
  sessionSampleSchema,
} from "./samples.js";
import { tracks } from "./tracks.js";

/**
 * The format a third-party device on a track chain was hosted in, as a
 * lowercase id: `vst3`, `vst`, `au`, or whatever else a DAW hosts (`clap`,
 * `aax`, `lv2`). Open rather than enumerated, so a DAW module that hosts a
 * format this list has never seen needs no server change.
 */
export const pluginHostSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,15}$/,
    'Must be a lowercase format id like "vst3" or "clap".'
  );

export type PluginHost = z.infer<typeof pluginHostSchema>;

/**
 * A DAW module's own id, as the scanner registry keys it: lowercase, stable,
 * and stored on every session that module finds — `"ableton"`, `"reaper"`.
 * `"manual"` names a session no module found: one added by hand.
 */
export const dawIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,31}$/,
    'Must be a lowercase id like "ableton" or "reaper".'
  );

/** The DAW's display name, shown in the UI beside its id: `"Ableton Live"`. */
const dawNameSchema = z.string().min(1).max(64);

/**
 * Everything a DAW module can report about a session, per `DawCapability` in
 * the scanner registry. Declared here rather than imported, since the server
 * does not depend on the scanner: a capability this list does not know is
 * dropped rather than refused, so a newer scanner does not fail against an
 * older server.
 */
export const DAW_CAPABILITIES = [
  "tempo",
  "key",
  "timeSignature",
  "dawVersion",
  "structure",
  "clips",
  "scenes",
  "plugins",
  "samplePaths",
  "renderHints",
  "backups",
  "trackColors",
] as const;

export type DawCapability = (typeof DAW_CAPABILITIES)[number];

const isDawCapability = (value: string): value is DawCapability =>
  (DAW_CAPABILITIES as readonly string[]).includes(value);

/** An array of capability strings, silently dropping anything unrecognised. */
export const dawCapabilitiesSchema = z
  .array(z.string())
  .transform((values) => values.filter(isDawCapability));

/**
 * The track kinds a session's structure can name. A kind this server does
 * not know — a future DAW's own vocabulary — is kept as `"other"` rather
 * than refused, so an unfamiliar structure still stores.
 */
const SESSION_TRACK_KINDS = [
  "audio",
  "midi",
  "return",
  "group",
  "master",
  "other",
] as const;

/**
 * A track's colour as the DAW shows it, as `#rrggbb`. A value that is not a
 * colour is dropped rather than refused: it costs the swatch, never the save
 * it arrived with.
 */
const trackColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .optional()
  .catch(undefined);

/**
 * The shape of a session as its DAW file describes it: what the tracks are
 * called, what is on each of them, and how many clips and scenes the set
 * holds. Two of these compared across saves is what turns "the session
 * changed" into "+2 tracks · +Serum 2 on 3 Lead", and aggregating over them
 * is the project's plugin inventory. `plugins` names the third-party devices
 * among those track chains, keyed by display name — a device absent from it
 * is one of the DAW's own. `truncated` marks a set large enough that the
 * parser stopped short of listing all of it. `clips` and `scenes` are
 * optional: a DAW without a clip-launcher concept, or one that cannot count
 * scenes, has none to report.
 */
export const sessionStructureSchema = z.object({
  tracks: z.array(
    z.object({
      kind: z.enum(SESSION_TRACK_KINDS).catch("other"),
      name: z.string(),
      devices: z.array(z.string()),
      /** The DAW's own id for this track, so a grouped track can name its parent. */
      id: z.number().optional(),
      /** The `id` of the group track this one sits in; absent at the top level. */
      groupId: z.number().optional(),
      color: trackColorSchema,
    })
  ),
  clips: z.object({ audio: z.number(), midi: z.number() }).optional(),
  scenes: z.number().optional(),
  plugins: z
    .record(
      z.string(),
      z.object({
        host: pluginHostSchema,
        manufacturer: z.string().optional(),
      })
    )
    .optional(),
  truncated: z.boolean().optional(),
});

export type SessionStructure = z.infer<typeof sessionStructureSchema>;

export const sessions = pgTable(
  "sessions",
  {
    ...baseSchema,
    name: text("name").notNull(),
    // The scanner registry's module id ("ableton", "reaper"), or "manual"
    // for a session added by hand — not a Postgres enum, so a new DAW module
    // needs no server migration. `dawName` and `dawCapabilities` are the
    // module's own display name and what it can report, carried alongside
    // rather than looked up, since a session outlives the scanner version
    // (or DAW) that made it.
    daw: text("daw").notNull(),
    dawName: text("daw_name"),
    dawCapabilities: text("daw_capabilities").array().notNull().default([]),
    /** A level of the project's own priority scale; see `tracks.priorityId`. */
    priorityId: integer("priority_id")
      .references(() => priorityLevels.id, { onDelete: "restrict" })
      .notNull(),
    main: boolean("main").notNull().default(false),
    trackId: integer("track_id").references(() => tracks.id, {
      onDelete: "set null",
    }),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),

    localFilepath: text("local_filepath"),
    localFileCreatedAt: timestamp("local_file_created_at"),
    localFileUpdatedAt: timestamp("local_file_updated_at"),
    localFileMachineName: text("local_file_machine_name"),
    fingerprint: text("fingerprint"),

    // The dit repo the set was adopted into, the id dit knows the set by, and
    // the branch it is on; null on a session the scanner found. The branch
    // reference is lazy since `branches` references this table back.
    repoId: integer("repo_id").references(() => repos.id, {
      onDelete: "set null",
    }),
    ditSetId: text("dit_set_id"),
    currentBranchId: integer("current_branch_id").references(
      (): AnyPgColumn => branches.id,
      { onDelete: "set null" }
    ),

    notes: jsonb("notes").$type<BlockDocument>(),
    notesText: text("notes_text").generatedAlwaysAs(
      sql`regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\\[|\\]$|"', '', 'g')`
    ),

    tempo: numeric("tempo"),
    timeSignature: varchar("time_signature", { length: 16 }),
    rootNote: varchar("root_note", { length: 4 }),
    scale: varchar("scale", { length: 64 }),
    tracksCount: integer("tracks_count"),
    scenesCount: integer("scenes_count"),
    dawVersion: text("daw_version"),
    structure: jsonb("structure").$type<SessionStructure>(),
  },
  (t) => [
    // Scopes to linked rows: unlinked mains (the scanner's bulk create
    // inserts mains before linking) may coexist — the later bulk-moves step
    // links them and re-enforces one main per track. The old where(main) form
    // made NULLs collide, so a second unlinked main violated it.
    uniqueIndex("one_main")
      .on(t.main, t.trackId)
      .where(and(eq(t.main, true), isNotNull(t.trackId)) as SQL),
    // Scoped to the project: two people scanning the same folder layout on
    // their own machines describe different sessions, and a global index would
    // have the second upsert rewrite the first one's row — project id included.
    uniqueIndex("dedupe_filepaths")
      .on(t.projectId, t.localFilepath)
      .where(isNotNull(t.localFilepath)),
    index("sessions_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
    index("sessions_local_filepath_trgm").using(
      "gin",
      t.localFilepath.op("gin_trgm_ops")
    ),
    index("sessions_notes_text_trgm").using(
      "gin",
      t.notesText.op("gin_trgm_ops")
    ),
    unique("session_repo_dit_set").on(t.repoId, t.ditSetId),
    index("sessions_project_fingerprint").on(t.projectId, t.fingerprint),
    index("sessions_track").on(t.trackId),
    index("sessions_project_updated").on(t.projectId, t.updatedAt),
    index("sessions_priority").on(t.priorityId),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/**
 * A session write as its wire body carries it: the row's columns plus the
 * sample list, which lives in `session_samples` rather than on the row. Null
 * empties the list; absent leaves it.
 */
export type WithSamples<T> = T & { samples?: SessionSample[] | null };

const sessionDocuments = {
  notes: true,
  structure: true,
} as const;

/**
 * The dit columns, dropped from both write schemas. Only the repo routes set
 * them, after checking the repo and branch are in the session's project; the
 * foreign keys alone would let a body point a session at another project's.
 */
const ditIgnores = {
  repoId: true,
  ditSetId: true,
  currentBranchId: true,
} as const;

export const sessionSchema = createSelectSchema(sessions)
  .omit(sessionDocuments)
  .extend({
    notes: blockDocumentSchema.nullable(),
    structure: sessionStructureSchema.nullable(),
  });

// The wire format for the local-file timestamps is a numeric epoch (ms),
// matching the asset-upload contract; z.date() (createInsertSchema's default)
// rejects JSON strings and numbers alike, and a Date can't exist in JSON.
// Output stays date-time strings — only the input is redefined.
//
// `preprocess` erases the input type, so a generated client would otherwise
// be told to send the `z.date()` output shape — a date-time string the route
// rejects. The metadata pins what the request body actually accepts.
export const epochDate = z
  .preprocess((v) => (v == null ? v : new Date(Number(v))), z.date())
  .meta({
    type: "integer",
    format: "int64",
    description: "Epoch milliseconds.",
  });

/**
 * The twelve pitch classes a session's root note may be, in the one spelling
 * they are stored as: sharps throughout, no flats.
 */
export const ROOT_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export type RootNote = (typeof ROOT_NOTES)[number];

/**
 * Every other spelling of those same twelve pitches, keyed by the uppercased
 * input with `♯`/`♭` folded to ASCII — so a flat reads as a trailing `B`.
 * A flat is the sharp a semitone below its own letter, except where there is
 * no black key between the letters: `Cb` and `Fb` drop to the natural `B` and
 * `E`, and `B#` and `E#` rise to the natural `C` and `F`.
 */
const ENHARMONIC_ROOT_NOTES: Record<string, RootNote> = {
  CB: "B",
  "B#": "C",
  DB: "C#",
  EB: "D#",
  "E#": "F",
  FB: "E",
  GB: "F#",
  AB: "G#",
  BB: "A#",
};

/** The two modes with a fixed capitalisation, keyed by the lowercased input. */
const MODES: Record<string, string> = { major: "Major", minor: "Minor" };

/**
 * A written root note as one of {@link ROOT_NOTES}, whatever accidental and
 * letter case it arrived in — `a♯`, `Bb` and `db` are all notes. Null for a
 * string that names none of the twelve.
 */
export function normaliseRootNote(value: string): RootNote | null {
  const spelling = value
    .trim()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .toUpperCase();

  if ((ROOT_NOTES as readonly string[]).includes(spelling)) {
    return spelling as RootNote;
  }
  return ENHARMONIC_ROOT_NOTES[spelling] ?? null;
}

/**
 * A written scale, trimmed, with `major` and `minor` pinned to one
 * capitalisation. Any other mode a DAW names — `Dorian`, `Harmonic Minor` —
 * is kept exactly as written, since the DAW's own spelling is what a later
 * scan compares against. Null for a blank one.
 */
export function normaliseScale(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return MODES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * A root note on the wire, normalised to one of {@link ROOT_NOTES}. An
 * unrecognised spelling is a zod issue, not a silent drop.
 */
export const rootNoteWireSchema = z
  .string()
  .transform((value, ctx) => {
    const note = normaliseRootNote(value);
    if (note == null) {
      ctx.addIssue({
        code: "custom",
        message: `Not a note: "${value}". Expected one of ${ROOT_NOTES.join(", ")}, or a flat spelling of one.`,
      });
      return z.NEVER;
    }
    return note;
  })
  .nullish();

/** A scale name on the wire, with `major`/`minor` pinned to one capitalisation. */
export const scaleWireSchema = z
  .string()
  .max(64)
  .transform(normaliseScale)
  .nullish();

// Normalising the musical key on the wire covers every writer at once — the
// scanner's bulk create, an in-app patch, a bulk update and the MCP tools all
// validate through these schemas — so the column only ever holds one spelling
// of a given key and a reader never has to guess.
const sessionWireFields = {
  localFileCreatedAt: epochDate.nullable().optional(),
  localFileUpdatedAt: epochDate.nullable().optional(),
  samples: z.array(sessionSampleSchema).max(MAX_SAMPLES).nullable().optional(),
  notes: blockDocumentSchema.nullish(),
  structure: sessionStructureSchema.nullish(),
  rootNote: rootNoteWireSchema,
  scale: scaleWireSchema,
};

export const newSessionSchema = createInsertSchema(sessions)
  .omit({ ...baseSchemaIgnores, ...sessionDocuments, ...ditIgnores })
  .extend({
    ...sessionWireFields,
    name: z.string().trim().min(1),
    daw: dawIdSchema,
    dawName: dawNameSchema.nullish(),
    dawCapabilities: dawCapabilitiesSchema.optional(),
    // Omitted, the project's default level applies.
    priorityId: z.number().int().optional(),
  });
export const editSessionSchema = createUpdateSchema(sessions)
  .omit({
    ...baseSchemaIgnores,
    ...scopeIgnores,
    ...sessionDocuments,
    ...ditIgnores,
  })
  .extend({
    ...sessionWireFields,
    name: z.string().trim().min(1).optional(),
    daw: dawIdSchema.optional(),
    dawName: dawNameSchema.nullish(),
    dawCapabilities: dawCapabilitiesSchema.optional(),
  });
