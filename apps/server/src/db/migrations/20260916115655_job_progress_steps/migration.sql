ALTER TYPE "job_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "percent" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "steps" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "step_index" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "step_percent" real;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "queue_position" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "progress";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "total";--> statement-breakpoint
CREATE INDEX "jobs_finished_at" ON "jobs" ("project_id","finished_at");