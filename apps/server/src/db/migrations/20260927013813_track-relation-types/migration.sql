CREATE TABLE "track_relation_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "track_relation_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_relations" ADD COLUMN "relation_type_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "track_relation_types_project_name" ON "track_relation_types" ("project_id","name");--> statement-breakpoint
CREATE INDEX "track_relations_type" ON "track_relations" ("relation_type_id");--> statement-breakpoint
ALTER TABLE "track_relation_types" ADD CONSTRAINT "track_relation_types_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_relations" ADD CONSTRAINT "track_relations_relation_type_id_track_relation_types_id_fkey" FOREIGN KEY ("relation_type_id") REFERENCES "track_relation_types"("id") ON DELETE RESTRICT;