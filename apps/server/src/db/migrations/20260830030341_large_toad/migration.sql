DROP INDEX "one_primary";--> statement-breakpoint
ALTER TABLE "assets"
    DROP COLUMN "audio_peaks";--> statement-breakpoint
ALTER TABLE "track_attachments"
    DROP COLUMN "primary_attachment";