ALTER TABLE "assets"
    DROP CONSTRAINT "assets_project_id_projects_id_fkey",
    ADD CONSTRAINT "assets_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "images"
    DROP CONSTRAINT "images_project_id_projects_id_fkey",
    ADD CONSTRAINT "images_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;