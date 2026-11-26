ALTER TYPE "comment_target_type" ADD VALUE 'track_audio';--> statement-breakpoint
CREATE TABLE "track_audios"
(
    "id"          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "track_audios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at"  timestamp DEFAULT now() NOT NULL,
    "updated_at"  timestamp DEFAULT now() NOT NULL,
    "track_id"    integer                 NOT NULL,
    "asset_id"    integer                 NOT NULL,
    "version"     integer                 NOT NULL,
    "is_primary"  boolean   DEFAULT false NOT NULL,
    "audio_peaks" jsonb,
    CONSTRAINT "track_audio_asset" UNIQUE ("track_id", "asset_id"),
    CONSTRAINT "track_audio_version" UNIQUE ("track_id", "version")
);
--> statement-breakpoint
ALTER TABLE "comments"
    ADD COLUMN "position_ms" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "one_primary_audio" ON "track_audios" ("track_id", "is_primary") WHERE "is_primary" = true;--> statement-breakpoint
ALTER TABLE "track_audios"
    ADD CONSTRAINT "track_audios_track_id_tracks_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_audios"
    ADD CONSTRAINT "track_audios_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON DELETE CASCADE;