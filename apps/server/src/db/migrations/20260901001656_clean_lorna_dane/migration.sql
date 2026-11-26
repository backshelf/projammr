ALTER TABLE "members"
    DROP CONSTRAINT "members_user_id_users_id_fkey",
    ADD CONSTRAINT "members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "members"
    DROP CONSTRAINT "members_project_id_projects_id_fkey",
    ADD CONSTRAINT "members_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;