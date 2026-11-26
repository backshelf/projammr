CREATE TABLE "sharelink_snapshot_track_audios" (
	"id" integer GENERATED ALWAYS AS IDENTITY (sequence name "sharelink_snapshot_track_audios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"track_audio_id" integer,
	"sharelink_id" integer,
	"title" text,
	"image" text,
	"position" integer,
	CONSTRAINT "sharelink_snapshot_track_audios_pkey" PRIMARY KEY("sharelink_id","track_audio_id"),
	CONSTRAINT "dedupe_sharelink_track_numbers" UNIQUE("sharelink_id","position")
);
--> statement-breakpoint
ALTER TABLE "sharelinks" DROP COLUMN "snapshot_tracks";--> statement-breakpoint
ALTER TABLE "sharelinks" ALTER COLUMN "expires_at" SET DEFAULT '9999-12-31 23:59:59+00';--> statement-breakpoint
CREATE INDEX "sharelink_snapshot_track" ON "sharelink_snapshot_track_audios" ("track_audio_id");--> statement-breakpoint
ALTER TABLE "sharelink_snapshot_track_audios" ADD CONSTRAINT "sharelink_snapshot_track_audios_L1PXfCOEMCTd_fkey" FOREIGN KEY ("track_audio_id") REFERENCES "track_audios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sharelink_snapshot_track_audios" ADD CONSTRAINT "sharelink_snapshot_track_audios_sharelink_id_sharelinks_id_fkey" FOREIGN KEY ("sharelink_id") REFERENCES "sharelinks"("id") ON DELETE CASCADE;