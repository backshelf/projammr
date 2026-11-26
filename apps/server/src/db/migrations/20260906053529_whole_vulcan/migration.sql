ALTER TABLE "comments" ADD COLUMN "project_id" integer;--> statement-breakpoint
UPDATE "comments" c SET "project_id" = p."id"
  FROM "projects" p
  WHERE c."target_type" = 'project' AND p."id" = c."target_id";--> statement-breakpoint
UPDATE "comments" c SET "project_id" = t."project_id"
  FROM "collections" t
  WHERE c."target_type" = 'collection' AND t."id" = c."target_id";--> statement-breakpoint
UPDATE "comments" c SET "project_id" = t."project_id"
  FROM "tracks" t
  WHERE c."target_type" = 'track' AND t."id" = c."target_id";--> statement-breakpoint
UPDATE "comments" c SET "project_id" = t."project_id"
  FROM "sessions" t
  WHERE c."target_type" = 'session' AND t."id" = c."target_id";--> statement-breakpoint
UPDATE "comments" c SET "project_id" = t."project_id"
  FROM "track_audios" ta
  JOIN "tracks" t ON t."id" = ta."track_id"
  WHERE c."target_type" = 'track_audio' AND ta."id" = c."target_id";--> statement-breakpoint
DELETE FROM "comments" WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_comment" ON "activity" ("comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_path" ON "assets" ("asset_path");--> statement-breakpoint
CREATE INDEX "assets_created_by" ON "assets" ("created_by_user");--> statement-breakpoint
CREATE INDEX "collection_attachments_collection" ON "collection_attachments" ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_attachments_asset" ON "collection_attachments" ("asset_id");--> statement-breakpoint
CREATE INDEX "project_attachments_project" ON "project_attachments" ("project_id");--> statement-breakpoint
CREATE INDEX "project_attachments_asset" ON "project_attachments" ("asset_id");--> statement-breakpoint
CREATE INDEX "session_attachments_asset" ON "session_attachments" ("asset_id");--> statement-breakpoint
CREATE INDEX "collection_tracks_track" ON "collection_tracks" ("track_id");--> statement-breakpoint
CREATE INDEX "collections_project_updated" ON "collections" ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "collections_status" ON "collections" ("status_id");--> statement-breakpoint
CREATE INDEX "comments_project" ON "comments" ("project_id");--> statement-breakpoint
CREATE INDEX "images_created_by" ON "images" ("created_by_user");--> statement-breakpoint
CREATE INDEX "images_project" ON "images" ("project_id");--> statement-breakpoint
CREATE INDEX "members_project" ON "members" ("project_id");--> statement-breakpoint
CREATE INDEX "sessions_track" ON "sessions" ("track_id");--> statement-breakpoint
CREATE INDEX "sessions_project_updated" ON "sessions" ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "track_audios_asset" ON "track_audios" ("asset_id");--> statement-breakpoint
CREATE INDEX "track_relations_to_track" ON "track_relations" ("to_track_id");--> statement-breakpoint
CREATE INDEX "tracks_project_updated" ON "tracks" ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "tracks_status" ON "tracks" ("status_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
