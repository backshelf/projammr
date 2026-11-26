ALTER TABLE "track_audios" ADD COLUMN "primary_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "bounced_from_save_id" integer;--> statement-breakpoint
ALTER TABLE "track_audios" ADD CONSTRAINT "track_audios_bounced_from_save_id_saves_id_fkey" FOREIGN KEY ("bounced_from_save_id") REFERENCES "saves"("id") ON DELETE SET NULL;