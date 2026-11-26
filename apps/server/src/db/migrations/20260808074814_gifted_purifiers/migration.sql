ALTER TABLE "statuses"
    ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "statuses"
    ADD CONSTRAINT "statuses_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;