CREATE TYPE "activity_action" AS ENUM ('created', 'updated', 'deleted');--> statement-breakpoint
CREATE TYPE "activity_target_type" AS ENUM ('project', 'collection', 'track', 'session');--> statement-breakpoint
CREATE TABLE "activity"
(
    "id"          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at"  timestamp DEFAULT now() NOT NULL,
    "project_id"  integer,
    "entity_type" "activity_target_type"  NOT NULL,
    "entity_id"   integer                 NOT NULL,
    "user_id"     text,
    "action"      "activity_action"       NOT NULL,
    "changes"     jsonb
);
--> statement-breakpoint
CREATE INDEX "activity_entity" ON "activity" ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX "activity_project" ON "activity" ("project_id", "created_at");--> statement-breakpoint
ALTER TABLE "activity"
    ADD CONSTRAINT "activity_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity"
    ADD CONSTRAINT "activity_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;