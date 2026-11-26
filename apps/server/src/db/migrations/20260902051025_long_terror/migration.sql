CREATE TYPE "saved_view_kind" AS ENUM ('tracks', 'collections', 'sessions');--> statement-breakpoint
CREATE TABLE "saved_views"
(
    "id"         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "saved_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "project_id" integer                 NOT NULL,
    "name"       varchar(255)            NOT NULL,
    "kind"       "saved_view_kind"       NOT NULL,
    "config"     jsonb                   NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_project_kind_name" ON "saved_views" ("project_id", "kind", "name");--> statement-breakpoint
ALTER TABLE "saved_views"
    ADD CONSTRAINT "saved_views_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;