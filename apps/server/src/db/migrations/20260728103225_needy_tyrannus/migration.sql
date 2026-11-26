ALTER TABLE "track_attachments" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "track_attachments" ADD PRIMARY KEY ("track_id","asset_id");