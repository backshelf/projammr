ALTER TABLE "assets"
    ADD COLUMN "local_filepath" text;--> statement-breakpoint
ALTER TABLE "assets"
    ADD COLUMN "local_file_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets"
    ADD COLUMN "local_file_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets"
    ADD COLUMN "local_file_machine_name" text;