CREATE TABLE "priority_levels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "priority_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"colour" text NOT NULL,
	"rank" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "priority_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "priority_id" integer;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "priority_id" integer;--> statement-breakpoint
CREATE INDEX "collections_priority" ON "collections" ("priority_id");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_levels_project_name" ON "priority_levels" ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_levels_project_rank" ON "priority_levels" ("project_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_levels_project_default" ON "priority_levels" ("project_id") WHERE "is_default" = true;--> statement-breakpoint
CREATE INDEX "sessions_priority" ON "sessions" ("priority_id");--> statement-breakpoint
CREATE INDEX "tracks_priority" ON "tracks" ("priority_id");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_priority_id_priority_levels_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority_levels"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "priority_levels" ADD CONSTRAINT "priority_levels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_priority_id_priority_levels_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority_levels"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_priority_id_priority_levels_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority_levels"("id") ON DELETE RESTRICT;