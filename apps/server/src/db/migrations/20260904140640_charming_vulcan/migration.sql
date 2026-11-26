CREATE FUNCTION pg_temp.notes_to_jsonb(raw text) RETURNS jsonb AS $$
BEGIN
    IF raw IS NULL OR raw = '' THEN
        RETURN NULL;
    END IF;
    RETURN raw::jsonb;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_array(jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', raw))
    ));
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "notes" SET DATA TYPE jsonb USING pg_temp.notes_to_jsonb("notes");--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "notes" SET DATA TYPE jsonb USING pg_temp.notes_to_jsonb("notes");--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "notes" SET DATA TYPE jsonb USING pg_temp.notes_to_jsonb("notes");--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "lyrics" SET DATA TYPE jsonb USING pg_temp.notes_to_jsonb("lyrics");--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (
    regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')
    ) STORED;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (
    regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')
    ) STORED;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (
    regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')
    ) STORED;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "lyrics_text" text GENERATED ALWAYS AS (
    regexp_replace(jsonb_path_query_array(lyrics,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')
    ) STORED;--> statement-breakpoint
CREATE INDEX "assets_name_trgm" ON "assets" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "collections_title_trgm" ON "collections" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "collections_upc_trgm" ON "collections" USING gin ("upc" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "collections_notes_text_trgm" ON "collections" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_content_trgm" ON "comments" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sessions_name_trgm" ON "sessions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sessions_local_filepath_trgm" ON "sessions" USING gin ("local_filepath" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sessions_notes_text_trgm" ON "sessions" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_title_trgm" ON "tracks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_isrc_trgm" ON "tracks" USING gin ("isrc" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_iswc_trgm" ON "tracks" USING gin ("iswc" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_notes_text_trgm" ON "tracks" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_lyrics_text_trgm" ON "tracks" USING gin ("lyrics_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tracks_artists_trgm" ON "tracks" USING gin (regexp_replace(jsonb_path_query_array("artists",'strict $[*]')
    ::text, '^\\[|\\]$|"', '', 'g') gin_trgm_ops);