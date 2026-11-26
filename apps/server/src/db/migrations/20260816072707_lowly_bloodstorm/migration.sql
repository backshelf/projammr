ALTER TABLE "session_attachments"
    ADD CONSTRAINT "session_asset" UNIQUE ("session_id", "asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dedupe_filepaths" ON "sessions" ("local_filepath") WHERE ("local_filepath" is not null);