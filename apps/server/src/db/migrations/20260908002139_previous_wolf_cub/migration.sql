CREATE TABLE "notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"author_id" text NOT NULL,
	"track_id" integer UNIQUE,
	"lyrics_mode" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"key_scope" text NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"wrapped_key" bytea NOT NULL,
	"body" bytea NOT NULL,
	"summary" bytea NOT NULL
);
--> statement-breakpoint
DROP INDEX "tracks_lyrics_text_trgm";--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "lyrics_text";--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "lyrics";--> statement-breakpoint
CREATE INDEX "notes_author_updated" ON "notes" ("author_id","updated_at");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_track_id_tracks_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL;