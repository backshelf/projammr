ALTER TABLE "sessions" ADD COLUMN "daw_name" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "daw_capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "daw" SET DATA TYPE text USING "daw"::text;--> statement-breakpoint
-- Backfill the display name and capabilities from the old enum value, while
-- it still reads "Ableton" verbatim: Ableton's sessions get its module id
-- and its full capability list; every other value (a DAW the old enum could
-- only misname, or a session added by hand) becomes a manual entry that
-- keeps its old value as the display name.
UPDATE "sessions" SET "daw_name" = 'Ableton Live', "daw_capabilities" = ARRAY['tempo','key','timeSignature','dawVersion','structure','clips','scenes','plugins','samplePaths','renderHints','backups'] WHERE "daw" = 'Ableton';--> statement-breakpoint
UPDATE "sessions" SET "daw_name" = "daw" WHERE "daw" <> 'Ableton';--> statement-breakpoint
UPDATE "sessions" SET "daw" = 'manual' WHERE "daw" <> 'Ableton';--> statement-breakpoint
UPDATE "sessions" SET "daw" = 'ableton' WHERE "daw" = 'Ableton';--> statement-breakpoint
DROP TYPE "daw";
