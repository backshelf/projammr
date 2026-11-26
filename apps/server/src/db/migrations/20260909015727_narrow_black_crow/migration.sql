ALTER TABLE "jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "lufs" real;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "lra" real;--> statement-breakpoint
ALTER TABLE "track_audios" ADD COLUMN "true_peak_db" real;