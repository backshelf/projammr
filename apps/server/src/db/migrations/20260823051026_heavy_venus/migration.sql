ALTER TABLE "sessions"
    ADD COLUMN "local_file_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "local_file_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "local_file_machine_name" text;