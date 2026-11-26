import {
  boolean,
  bytea,
  integer,
  jsonb,
  pgTable,
  real,
  unique,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";
import { baseSchema } from "./base.js";
import { trackAudios } from "./tracks.js";

/**
 * One version's onset, mel and chroma series, quantised to bytes over their
 * own range at analysis time — stored exactly as `OfflineAnalyses.features`
 * exposes them, so a consecutive diff or a duplicate check dequantises them
 * straight back into `@workspace/dsp/offline`'s `FeatureSet` with no
 * re-decode. One row per track audio; gone when the row is.
 */
export const trackAudioFeatures = pgTable(
  "track_audio_features",
  {
    ...baseSchema,
    trackAudioId: integer("track_audio_id")
      .references(() => trackAudios.id, { onDelete: "cascade" })
      .notNull(),
    onset: bytea("onset").notNull(),
    onsetMin: real("onset_min").notNull(),
    onsetMax: real("onset_max").notNull(),
    mel: bytea("mel").notNull(),
    melMin: real("mel_min").notNull(),
    melMax: real("mel_max").notNull(),
    chroma: bytea("chroma").notNull(),
    chromaMin: real("chroma_min").notNull(),
    chromaMax: real("chroma_max").notNull(),
    analysisVersion: integer("analysis_version").notNull(),
  },
  (t) => [unique("track_audio_features_track_audio").on(t.trackAudioId)]
);

export type TrackAudioFeatures = typeof trackAudioFeatures.$inferSelect;
export type NewTrackAudioFeatures = typeof trackAudioFeatures.$inferInsert;

/**
 * A stored comparison between two versions of the same track: `fromId` is the
 * earlier version, `toId` the later one. Written after every analysis for the
 * pair immediately behind the new version, and, when it would otherwise leave
 * a gap (a middle version was deleted), the pair immediately ahead of it too.
 */
export const trackAudioDiffs = pgTable(
  "track_audio_diffs",
  {
    ...baseSchema,
    fromId: integer("from_id")
      .references(() => trackAudios.id, { onDelete: "cascade" })
      .notNull(),
    toId: integer("to_id")
      .references(() => trackAudios.id, { onDelete: "cascade" })
      .notNull(),
    /** Whether the onset alignment found a confident offset between the two. */
    aligned: boolean("aligned").notNull(),
    /** The offset in ms at which `toId` best matches `fromId`; null when not aligned. */
    offsetMs: integer("offset_ms"),
    /** Per second of `fromId`, 0..1 change; 1 where `toId` has no counterpart. */
    change: jsonb("change").$type<number[]>().notNull(),
    /** Per second, LU; empty unless both versions carried a loudness curve. */
    loudnessDelta: jsonb("loudness_delta").$type<number[]>().notNull(),
    summary: jsonb("summary")
      .$type<{
        changedSeconds: number;
        changedShare: number;
        loudestChange: { startMs: number; endMs: number } | null;
      }>()
      .notNull(),
    analysisVersion: integer("analysis_version").notNull(),
  },
  (t) => [unique("track_audio_diff_pair").on(t.fromId, t.toId)]
);

export type TrackAudioDiff = typeof trackAudioDiffs.$inferSelect;
export type NewTrackAudioDiff = typeof trackAudioDiffs.$inferInsert;

export const diffSummarySchema = z.object({
  changedSeconds: z.number(),
  changedShare: z.number(),
  loudestChange: z
    .object({ startMs: z.number(), endMs: z.number() })
    .nullable(),
});

/**
 * A comparison between two versions as the API serves it, whether read from
 * a stored row or computed for the pair on request, so it carries no row
 * identity.
 */
export const trackAudioDiffSchema = createSelectSchema(trackAudioDiffs)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    change: true,
    loudnessDelta: true,
    summary: true,
  })
  .extend({
    change: z.array(z.number()),
    loudnessDelta: z.array(z.number()),
    summary: diffSummarySchema,
  });
