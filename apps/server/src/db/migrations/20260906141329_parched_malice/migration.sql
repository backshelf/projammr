ALTER TABLE "sessions" DROP COLUMN "notes_text";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')) STORED;--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "notes_text";--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')) STORED;--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "lyrics_text";--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "lyrics_text" text GENERATED ALWAYS AS (regexp_replace(jsonb_path_query_array(lyrics,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')) STORED;--> statement-breakpoint
CREATE INDEX "sessions_notes_text_trgm" ON "sessions" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_notes_text_trgm" ON "tracks" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_lyrics_text_trgm" ON "tracks" USING gin ("lyrics_text" gin_trgm_ops);