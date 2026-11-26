CREATE TABLE "custom_field_values" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custom_field_values_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"field_id" integer NOT NULL,
	"track_id" integer,
	"collection_id" integer,
	"text_value" text,
	"number_value" numeric,
	"date_value" date,
	"bool_value" boolean,
	"option_value" text,
	"url_value" text,
	CONSTRAINT "custom_field_values_one_entity" CHECK (num_nonnulls("track_id", "collection_id") = 1),
	CONSTRAINT "custom_field_values_one_value" CHECK (num_nonnulls("text_value", "number_value", "date_value", "bool_value", "option_value", "url_value") = 1)
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custom_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"entity_kind" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]' NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_track_field" ON "custom_field_values" ("track_id","field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_collection_field" ON "custom_field_values" ("collection_id","field_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_text" ON "custom_field_values" ("field_id","text_value");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_number" ON "custom_field_values" ("field_id","number_value");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_date" ON "custom_field_values" ("field_id","date_value");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_bool" ON "custom_field_values" ("field_id","bool_value");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_option" ON "custom_field_values" ("field_id","option_value");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_url" ON "custom_field_values" ("field_id","url_value");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_project_kind_name" ON "custom_fields" ("project_id","entity_kind","name");--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_custom_fields_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_track_id_tracks_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_collection_id_collections_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;