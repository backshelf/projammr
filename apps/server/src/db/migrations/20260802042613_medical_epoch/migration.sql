CREATE TABLE "statuses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "statuses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" varchar(255) NOT NULL UNIQUE,
	"status_percentage" integer DEFAULT 0 NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "key" varchar(255);--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "bpm" numeric;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "key";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "bpm";