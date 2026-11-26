CREATE TABLE "track_audio_diffs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "track_audio_diffs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"from_id" integer NOT NULL,
	"to_id" integer NOT NULL,
	"aligned" boolean NOT NULL,
	"offset_ms" integer,
	"change" jsonb NOT NULL,
	"loudness_delta" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"analysis_version" integer NOT NULL,
	CONSTRAINT "track_audio_diff_pair" UNIQUE("from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "track_audio_features" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "track_audio_features_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"track_audio_id" integer NOT NULL CONSTRAINT "track_audio_features_track_audio" UNIQUE,
	"onset" bytea NOT NULL,
	"onset_min" real NOT NULL,
	"onset_max" real NOT NULL,
	"mel" bytea NOT NULL,
	"mel_min" real NOT NULL,
	"mel_max" real NOT NULL,
	"chroma" bytea NOT NULL,
	"chroma_min" real NOT NULL,
	"chroma_max" real NOT NULL,
	"analysis_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "bpm" real;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "bpm_confidence" real;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "beat_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "musical_key" text;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "key_confidence" real;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "loudness_curve" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "correlation_curve" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "clipping" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "silence" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "pitch_track" jsonb;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "spectrogram_key" text;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "duplicate_of_id" integer;--> statement-breakpoint
ALTER TABLE "track_audio_diffs" ADD CONSTRAINT "track_audio_diffs_from_id_track_audios_id_fkey" FOREIGN KEY ("from_id") REFERENCES "track_audios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_audio_diffs" ADD CONSTRAINT "track_audio_diffs_to_id_track_audios_id_fkey" FOREIGN KEY ("to_id") REFERENCES "track_audios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_audio_features" ADD CONSTRAINT "track_audio_features_track_audio_id_track_audios_id_fkey" FOREIGN KEY ("track_audio_id") REFERENCES "track_audios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_audios" ADD CONSTRAINT "track_audios_duplicate_of_id_track_audios_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "track_audios"("id") ON DELETE SET NULL;