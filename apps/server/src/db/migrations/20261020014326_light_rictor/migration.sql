ALTER TYPE "job_kind" ADD VALUE 'save_content_sweep';--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "push_samples" boolean DEFAULT false NOT NULL;