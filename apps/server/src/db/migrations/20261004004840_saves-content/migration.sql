CREATE TYPE "content_state" AS ENUM('none', 'pending', 'stored', 'pruned');--> statement-breakpoint
ALTER TYPE "revision_source" RENAME TO "save_source";--> statement-breakpoint
ALTER TYPE "save_source" ADD VALUE 'dit';--> statement-breakpoint
ALTER TABLE "session_revisions" RENAME TO "saves";--> statement-breakpoint
ALTER INDEX "revision_session_time" RENAME TO "save_session_time";--> statement-breakpoint
ALTER INDEX "revision_project_time" RENAME TO "save_project_time";--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "xml_hash" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "tree" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "view_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "unreadable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "content_state" "content_state" DEFAULT 'none'::"content_state" NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "save_session_hash" ON "saves" ("session_id","hash") WHERE "hash" is not null;