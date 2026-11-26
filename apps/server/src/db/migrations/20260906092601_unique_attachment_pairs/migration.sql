-- An asset is attached to a project or a collection once. Sessions and tracks
-- already say so in their join tables; these two did not, so the same asset
-- could be attached repeatedly and each add wrote another row. The oldest row
-- of every duplicate group is kept and the rest are dropped before the
-- constraint goes on.

DELETE FROM "collection_attachments" a
  USING "collection_attachments" b
  WHERE a."collection_id" = b."collection_id"
    AND a."asset_id" = b."asset_id"
    AND a."id" > b."id";--> statement-breakpoint

DELETE FROM "project_attachments" a
  USING "project_attachments" b
  WHERE a."project_id" = b."project_id"
    AND a."asset_id" = b."asset_id"
    AND a."id" > b."id";--> statement-breakpoint

ALTER TABLE "collection_attachments" ADD CONSTRAINT "collection_asset" UNIQUE("collection_id","asset_id");--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_asset" UNIQUE("project_id","asset_id");
