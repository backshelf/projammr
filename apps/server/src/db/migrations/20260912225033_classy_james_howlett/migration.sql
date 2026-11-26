ALTER TABLE "collections" DROP COLUMN "notes_text";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "notes_text" text GENERATED ALWAYS AS (regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, '^\[|\]$|"', '', 'g')) STORED;--> statement-breakpoint
CREATE INDEX "collections_notes_text_trgm" ON "collections" USING gin ("notes_text" gin_trgm_ops);