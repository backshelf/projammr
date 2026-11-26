ALTER TABLE "machines" DROP CONSTRAINT "machines_user_name";--> statement-breakpoint
DROP INDEX "time_segment_key";--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "machine_id" text;--> statement-breakpoint
ALTER TABLE "commits" ADD COLUMN "machine_id" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "last_push_machine_id" text;--> statement-breakpoint
ALTER TABLE "time_segments" ADD COLUMN "machine_id" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "auth_session_id" text;--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN "last_push_machine";--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segment_key" UNIQUE NULLS NOT DISTINCT("session_id","branch_id","machine_name","machine_id","started_at");--> statement-breakpoint
CREATE INDEX "save_machine" ON "saves" ("machine_id");--> statement-breakpoint
CREATE INDEX "commit_machine" ON "commits" ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_user_name" ON "machines" ("user_id","name") WHERE "removed_at" is null;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_machine_id_machines_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_machine_id_machines_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_last_push_machine_id_machines_id_fkey" FOREIGN KEY ("last_push_machine_id") REFERENCES "machines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segments_machine_id_machines_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_auth_session_id_auth_sessions_id_fkey" FOREIGN KEY ("auth_session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL;