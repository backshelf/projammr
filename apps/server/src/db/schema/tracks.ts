import { eq, getColumns, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
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
import type { ClippedBin, Section, Silence } from "@workspace/dsp/offline";
import type { Spectrum } from "@workspace/dsp/spectrum";
import { assets, assetSchema } from "./assets.js";
import {
  type BlockDocument,
  baseSchema,
  baseSchemaIgnores,
  blockDocumentSchema,
  scopeIgnores,
} from "./base.js";
import { commitKindEnum } from "./enums.js";
import { priorityLevels } from "./priority-levels.js";
import { projects } from "./projects.js";
import { saves } from "./saves.js";
import { statuses } from "./statuses.js";
import {
  relationTypeSchema,
  trackRelationTypes,
} from "./track-relation-types.js";

export const tracks = pgTable(
  "tracks",
  {
    ...baseSchema,
    title: text("title").notNull(),
    artists: jsonb("artists").$type<string[]>().notNull(),
    /**
     * A level of the project's own priority scale. A level cannot be deleted
     * while rows point at it: deleting one names the level they move to.
     */
    priorityId: integer("priority_id")
      .references(() => priorityLevels.id, { onDelete: "restrict" })
      .notNull(),

    statusId: integer("status_id")
      .default(1)
      .references(() => statuses.id, {
        onDelete: "set default",
      }),

    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),

    notes: jsonb("notes").$type<BlockDocument>(),
    notesText: text("notes_text").generatedAlwaysAs(
      sql`regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\\[|\\]$|"', '', 'g')`
    ),

    image: text("image"),

    isrc: varchar("isrc", { length: 26 }),
    iswc: varchar("iswc", { length: 26 }),

    /** Carries explicit content (a parental advisory on release). */
    explicit: boolean("explicit").notNull().default(false),

    /**
     * When the track was archived; null while it is live. An archived track
     * leaves the paginated lists and keeps everything else. Its sessions are
     * archived with it, derived from this column rather than stored.
     */
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    index("tracks_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
    index("tracks_isrc_trgm").using("gin", t.isrc.op("gin_trgm_ops")),
    index("tracks_iswc_trgm").using("gin", t.iswc.op("gin_trgm_ops")),
    index("tracks_notes_text_trgm").using(
      "gin",
      t.notesText.op("gin_trgm_ops")
    ),
    index("tracks_artists_trgm").using(
      "gin",
      sql`regexp_replace(jsonb_path_query_array(${t.artists},'strict $[*]')::text, '^\\[|\\]$|"', '', 'g') gin_trgm_ops`
    ),
    index("tracks_project_updated").on(t.projectId, t.updatedAt),
    index("tracks_status").on(t.statusId),
    index("tracks_priority").on(t.priorityId),
  ]
);

export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;

const trackDocuments = { artists: true, notes: true } as const;

/** Columns only the archive routes write, so neither create nor edit can set them. */
const trackArchiveIgnores = { archivedAt: true } as const;

export const trackSchema = createSelectSchema(tracks)
  .omit(trackDocuments)
  .extend({
    artists: z.array(z.string()),
    notes: blockDocumentSchema.nullable(),
  });
export const newTrackSchema = createInsertSchema(tracks)
  .omit({ ...trackDocuments, ...baseSchemaIgnores, ...trackArchiveIgnores })
  .extend({
    title: z.string().trim().min(1),
    // Omitted, the project's default artists, status and explicit flag apply
    // (`createTrack`); every track has a status, since the track response's
    // `status` is not nullable.
    artists: z.array(z.string()).optional(),
    notes: blockDocumentSchema.nullish(),
    statusId: z.number().int().optional(),
    // Omitted, the project's default level applies.
    priorityId: z.number().int().optional(),
  });
export const editTrackSchema = createUpdateSchema(tracks)
  .omit({
    ...trackDocuments,
    ...baseSchemaIgnores,
    ...scopeIgnores,
    ...trackArchiveIgnores,
  })
  .extend({
    title: z.string().trim().min(1).optional(),
    artists: z.array(z.string()).optional(),
    notes: blockDocumentSchema.nullish(),
    statusId: z.number().int().optional(),
  });

/**
 * A directed relation between two tracks: `fromTrackId` is the derivative,
 * `toTrackId` is the source (track A "remix of" track B). The row is stored
 * once; the inverse label ("remixed by") is derived in the UI.
 */
export const trackRelations = pgTable(
  "track_relations",
  {
    ...baseSchema,
    fromTrackId: integer("from_track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    toTrackId: integer("to_track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * A type of the from-track's project's list. A type cannot be deleted
     * while relations use it.
     */
    relationTypeId: integer("relation_type_id")
      .references(() => trackRelationTypes.id, { onDelete: "restrict" })
      .notNull(),
  },
  (t) => [
    uniqueIndex("track_relation_unique").on(
      t.fromTrackId,
      t.toTrackId,
      t.relationTypeId
    ),
    // The unique index leads with `from_track_id`; the inverse direction ("what
    // is derived from this track") needs its own.
    index("track_relations_to_track").on(t.toTrackId),
    index("track_relations_type").on(t.relationTypeId),
  ]
);

export type NewTrackRelation = typeof trackRelations.$inferInsert;

/** A relation row as the relation writes answer it: with the type it carries. */
export const trackRelationSchema = createSelectSchema(trackRelations).extend({
  relationType: relationTypeSchema,
});

export type TrackRelationRow = z.infer<typeof trackRelationSchema>;

// duplicateOfId is a self-reference: declared without .references() to avoid
// TS circular inference, added via foreignKey() in the extra config callback
// (the same pattern comments.ts uses for parentId).
export const trackAudios = pgTable(
  "track_audios",
  {
    ...baseSchema,
    trackId: integer("track_id")
      .references(() => tracks.id, { onDelete: "cascade" })
      .notNull(),
    assetId: integer("asset_id")
      .references(() => assets.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    audioPeaks: jsonb("audio_peaks").$type<number[]>(),
    /** Long-term average spectrum, tilted band levels. Null until first measured from the file. */
    ltas: jsonb("ltas").$type<Spectrum>(),
    /** Playing length in milliseconds. Null until first probed from the file. */
    durationMs: integer("duration_ms"),
    /** Integrated loudness in LUFS. Null until first measured from the file. */
    lufs: real("lufs"),
    /** Loudness range in LU. Null until first measured from the file. */
    lra: real("lra"),
    /** True peak in dBFS. Null until first measured from the file. */
    truePeakDb: real("true_peak_db"),
    /**
     * The `@workspace/dsp` `ANALYSIS_VERSION` this row's measurements were
     * decoded under. Null, or behind the package's current value, marks the
     * row outstanding for another decode.
     */
    analysisVersion: integer("analysis_version"),
    /** Detected tempo in BPM, one decimal. Null until measured, or undetectable. */
    bpm: real("bpm"),
    /** 0..1 confidence in {@link bpm}. */
    bpmConfidence: real("bpm_confidence"),
    /** The first beat of the grid, `0 <= beatOffsetMs < 60000 / bpm`. */
    beatOffsetMs: integer("beat_offset_ms"),
    /** Detected musical key, e.g. `"F♯ minor"`, sharps throughout. */
    musicalKey: text("musical_key"),
    /** 0..1 confidence in {@link musicalKey}. */
    keyConfidence: real("key_confidence"),
    /** Repeat-grouped sections across the track. */
    sections: jsonb("sections").$type<Section[]>(),
    /** Short-term LUFS per second; null seconds are gated below −70 LUFS. */
    loudnessCurve: jsonb("loudness_curve").$type<(number | null)[]>(),
    /** L/R correlation per second, −1..1. */
    correlationCurve: jsonb("correlation_curve").$type<number[]>(),
    /** 50 ms bins that clipped. */
    clipping: jsonb("clipping").$type<ClippedBin[]>(),
    /** Leading and trailing silence, in milliseconds. */
    silence: jsonb("silence").$type<Silence>(),
    /** Dominant pitch per 50 ms, Hz, 0 where unvoiced. */
    pitchTrack: jsonb("pitch_track").$type<number[]>(),
    /** Key of the stored spectrogram PNG under `static/analysis/`, or null before one is written. */
    spectrogramKey: text("spectrogram_key"),
    /** Bytes that PNG takes, counted towards the track's project. */
    spectrogramBytes: integer("spectrogram_bytes").notNull().default(0),
    /**
     * The lowest-numbered other current version this one's fingerprint
     * matches (similarity above 0.98, durations within 1 s). Null when no
     * such version exists.
     */
    duplicateOfId: integer("duplicate_of_id"),
    /**
     * Whether the primary was chosen by hand. Only a hand choice pins it; an
     * automatic promotion never moves a pinned primary.
     */
    primaryPinned: boolean("primary_pinned").notNull().default(false),
    /** The save a render of this version was accepted from, or null. */
    bouncedFromSaveId: integer("bounced_from_save_id").references(
      () => saves.id,
      { onDelete: "set null" }
    ),
  },
  (t) => [
    unique("track_audio_asset").on(t.trackId, t.assetId),
    unique("track_audio_version").on(t.trackId, t.version),
    uniqueIndex("one_primary_audio")
      .on(t.trackId, t.isPrimary)
      .where(eq(t.isPrimary, true)),
    index("track_audios_asset").on(t.assetId),
    // Every analysis writes a fresh key, so this is never violated by two
    // rows pointing at the same file; it is what the static route resolves a
    // spectrogram request through.
    uniqueIndex("track_audios_spectrogram_key").on(t.spectrogramKey),
    foreignKey({
      columns: [t.duplicateOfId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
  ]
);

export type TrackAudio = typeof trackAudios.$inferSelect;
export type NewTrackAudio = typeof trackAudios.$inferInsert;

/**
 * A version's columns as a share reader may see them. The primary pin and the
 * bounce link are the project's own bookkeeping, so they are left out.
 */
export function sharedTrackAudioColumns() {
  const columns = getColumns(trackAudios);
  return Object.fromEntries(
    Object.entries(columns).filter(
      ([key]) => key !== "primaryPinned" && key !== "bouncedFromSaveId"
    )
  ) as Omit<typeof columns, "primaryPinned" | "bouncedFromSaveId">;
}

/** A measured curve on the wire: band centres in Hz and the level per band in dB. */
export const spectrumSchema = z.object({
  hz: z.array(z.number()),
  db: z.array(z.number()),
});

/** A repeat-grouped section of a track. */
export const sectionSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  group: z.string(),
});

/** A 50 ms bin whose samples clipped. */
export const clipSchema = z.object({
  binIndex: z.number(),
  samples: z.number(),
  over: z.boolean(),
});

/** Leading and trailing silence, in milliseconds. */
export const silenceSchema = z.object({
  leadMs: z.number(),
  tailMs: z.number(),
});

/**
 * The measurement columns big enough that no read pulls them by default: each
 * is served lazily, through the measures route — `entities/track-audio/
 * measures.ts`'s registry checks its own column set against this list at load
 * time, so the two cannot silently drift apart. Every mask below is derived
 * from this one list rather than repeating the column names of its own.
 */
export const LAZY_TRACK_AUDIO_COLUMNS = [
  "audioPeaks",
  "ltas",
  "sections",
  "loudnessCurve",
  "correlationCurve",
  "clipping",
  "pitchTrack",
] as const;

type LazyTrackAudioColumn = (typeof LAZY_TRACK_AUDIO_COLUMNS)[number];

function lazyColumnMask<const V>(value: V): Record<LazyTrackAudioColumn, V> {
  return Object.fromEntries(
    LAZY_TRACK_AUDIO_COLUMNS.map((column) => [column, value])
  ) as Record<LazyTrackAudioColumn, V>;
}

const trackAudioLazyFieldsMask = lazyColumnMask(true);

/** {@link trackAudioLazyFieldsMask}'s keys, for a query's own `columns` filter. */
export const trackAudioLazyColumns = lazyColumnMask(false);

export const trackAudioSchema = createSelectSchema(trackAudios)
  .omit(trackAudioLazyFieldsMask)
  .extend({ silence: silenceSchema.nullable() });
const bouncedFromSchema = z.object({
  saveId: z.number(),
  /** The session the save belongs to, where the version links back to. */
  sessionId: z.number(),
  savedAt: z.date(),
  commit: z
    .object({
      id: z.number(),
      message: z.string(),
      committedAt: z.date(),
      branch: z.string(),
      kind: z.enum(commitKindEnum.enumValues),
    })
    .nullable(),
});

export type BouncedFrom = z.infer<typeof bouncedFromSchema>;

export const trackAudioWithAssetSchema = trackAudioSchema.extend({
  asset: assetSchema,
  bouncedFrom: bouncedFromSchema.nullable(),
});
