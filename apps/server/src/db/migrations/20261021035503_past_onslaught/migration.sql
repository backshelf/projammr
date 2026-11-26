CREATE TYPE "segment_source" AS ENUM('script', 'log', 'title', 'saves');--> statement-breakpoint
CREATE TABLE "time_segments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"session_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"machine_name" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"source" "segment_source" NOT NULL,
	CONSTRAINT "time_segment_order" CHECK ("ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "time_segment_key" ON "time_segments" ("session_id","branch_id","machine_name","started_at");--> statement-breakpoint
CREATE INDEX "time_segment_branch" ON "time_segments" ("branch_id","started_at");--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segments_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segments_branch_id_branches_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE;