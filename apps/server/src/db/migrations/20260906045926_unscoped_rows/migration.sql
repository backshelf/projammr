-- Rows with no project were writable by any signed-in user, because
-- authorization had nothing to gate them on. They are removed before the
-- column stops accepting NULL: a project-less track, collection, session or
-- asset has no owner to hand it back to. The files behind orphan asset and
-- image rows stay on disk and are unreachable — the static handler serves
-- nothing that has no row.
DELETE FROM "tracks" WHERE "project_id" IS NULL;--> statement-breakpoint
DELETE FROM "collections" WHERE "project_id" IS NULL;--> statement-breakpoint
DELETE FROM "sessions" WHERE "project_id" IS NULL;--> statement-breakpoint
DELETE FROM "assets" WHERE "project_id" IS NULL;--> statement-breakpoint
-- Images keep project-less rows: an avatar is scoped to its uploader. Only
-- those naming neither a project nor an uploader are unreachable.
DELETE FROM "images"
  WHERE NOT (
    ("scope" = 'project' AND "project_id" IS NOT NULL)
    OR ("scope" = 'user' AND "created_by_user" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "dedupe_filepaths";--> statement-breakpoint
CREATE UNIQUE INDEX "dedupe_filepaths" ON "sessions" ("project_id","local_filepath") WHERE ("local_filepath" is not null);--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_project_id_projects_id_fkey", ADD CONSTRAINT "collections_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_project_id_projects_id_fkey", ADD CONSTRAINT "sessions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_project_id_projects_id_fkey", ADD CONSTRAINT "tracks_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_scope_owner" CHECK (("scope" = 'project' AND "project_id" IS NOT NULL)
        OR ("scope" = 'user' AND "created_by_user" IS NOT NULL));