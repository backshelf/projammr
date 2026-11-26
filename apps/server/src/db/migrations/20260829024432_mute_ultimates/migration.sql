ALTER TABLE "sessions"
    ADD COLUMN "tempo" numeric;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "time_signature" varchar(16);--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "root_note" varchar(4);--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "scale" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "tracks_count" integer;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "scenes_count" integer;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "daw_version" text;--> statement-breakpoint
ALTER TABLE "sessions"
    ADD COLUMN "sample_paths" jsonb;