CREATE TYPE "label_target_type" AS ENUM ('track', 'collection', 'session');--> statement-breakpoint
CREATE TABLE "entity_labels"
(
    "label_id"    integer,
    "entity_type" "label_target_type",
    "entity_id"   integer,
    CONSTRAINT "entity_labels_pkey" PRIMARY KEY ("label_id", "entity_type", "entity_id")
);
--> statement-breakpoint
CREATE TABLE "labels"
(
    "id"         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "labels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "created_at" timestamp  DEFAULT now()     NOT NULL,
    "updated_at" timestamp  DEFAULT now()     NOT NULL,
    "name"       varchar(255)                 NOT NULL,
    "colour_hex" varchar(9) DEFAULT '#94A3B8' NOT NULL,
    "project_id" integer                      NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entity_labels_entity" ON "entity_labels" ("entity_type", "entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_project_name" ON "labels" ("project_id", "name");--> statement-breakpoint
ALTER TABLE "entity_labels"
    ADD CONSTRAINT "entity_labels_label_id_labels_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "labels"
    ADD CONSTRAINT "labels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;