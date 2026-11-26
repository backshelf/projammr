CREATE TYPE "revision_source" AS ENUM('scan', 'backup', 'app');--> statement-breakpoint
CREATE TABLE "session_revisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"session_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"file_updated_at" timestamp NOT NULL,
	"fingerprint" text,
	"machine_name" text,
	"source" "revision_source" NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "revision_session_time" ON "session_revisions" ("session_id","file_updated_at");--> statement-breakpoint
CREATE INDEX "revision_project_time" ON "session_revisions" ("project_id","file_updated_at");--> statement-breakpoint
ALTER TABLE "session_revisions" ADD CONSTRAINT "session_revisions_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_revisions" ADD CONSTRAINT "session_revisions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;