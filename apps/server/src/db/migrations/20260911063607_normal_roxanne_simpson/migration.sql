CREATE TYPE "sharelink_entity" AS ENUM('collection', 'track');--> statement-breakpoint
CREATE TYPE "sharelink_type" AS ENUM('snapshot', 'connected');--> statement-breakpoint
CREATE TABLE "sharelinks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sharelinks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp DEFAULT 'infinity' NOT NULL,
	"entity_type" "sharelink_entity" NOT NULL,
	"entity_id" integer NOT NULL,
	"description" text,
	"is_comments_private" boolean DEFAULT false NOT NULL,
	"is_downloads_enabled" boolean DEFAULT false NOT NULL,
	"share_type" "sharelink_type" NOT NULL,
	"snapshot_title" text,
	"snapshot_tracks" jsonb
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_anonymous" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "sharelinks_token" ON "sharelinks" ("token");