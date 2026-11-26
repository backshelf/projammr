CREATE TYPE "sample_kind" AS ENUM('project', 'outside', 'library');--> statement-breakpoint
CREATE TYPE "sample_status" AS ENUM('present', 'missing', 'unknown');--> statement-breakpoint
CREATE TABLE "session_samples" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"session_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"path" text NOT NULL,
	"kind" "sample_kind" NOT NULL,
	"status" "sample_status" NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "sample_paths";--> statement-breakpoint
CREATE UNIQUE INDEX "session_sample_path" ON "session_samples" ("session_id","path");--> statement-breakpoint
CREATE INDEX "session_sample_project_path" ON "session_samples" ("project_id","path");--> statement-breakpoint
ALTER TABLE "session_samples" ADD CONSTRAINT "session_samples_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_samples" ADD CONSTRAINT "session_samples_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;