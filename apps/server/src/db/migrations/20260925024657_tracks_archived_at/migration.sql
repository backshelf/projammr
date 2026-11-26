ALTER TYPE "activity_action" ADD VALUE 'archived';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE 'unarchived';--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "archived_at" timestamp;