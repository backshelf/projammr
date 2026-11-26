CREATE TYPE "render_rejection_kind" AS ENUM('not-a-bounce', 'never-here');--> statement-breakpoint
CREATE TABLE "render_rejections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "render_rejections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"kind" "render_rejection_kind" NOT NULL,
	"fingerprint" text,
	"file_name" text,
	"machine_id" text,
	"folder" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "render_rejections_fields_by_kind" CHECK (("kind" = 'not-a-bounce' AND "fingerprint" IS NOT NULL AND "machine_id" IS NULL AND "folder" IS NULL)
        OR ("kind" = 'never-here' AND "machine_id" IS NOT NULL AND "folder" IS NOT NULL AND "fingerprint" IS NULL AND "file_name" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "render_rejections_bounce" ON "render_rejections" ("user_id","fingerprint") WHERE "kind" = 'not-a-bounce';--> statement-breakpoint
CREATE UNIQUE INDEX "render_rejections_folder" ON "render_rejections" ("machine_id","folder") WHERE "kind" = 'never-here';--> statement-breakpoint
CREATE INDEX "render_rejections_user" ON "render_rejections" ("user_id");--> statement-breakpoint
ALTER TABLE "render_rejections" ADD CONSTRAINT "render_rejections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "render_rejections" ADD CONSTRAINT "render_rejections_machine_id_machines_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE;