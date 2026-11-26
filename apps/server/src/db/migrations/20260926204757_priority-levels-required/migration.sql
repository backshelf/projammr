ALTER TABLE "collections" DROP COLUMN "priority";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "priority";--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "priority";--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "priority_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "priority_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "priority_id" SET NOT NULL;--> statement-breakpoint
DROP TYPE "priority";