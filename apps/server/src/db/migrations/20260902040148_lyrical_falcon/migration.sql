ALTER TYPE "relation_type" ADD VALUE 'remaster' BEFORE 'edit';--> statement-breakpoint
ALTER TYPE "relation_type" ADD VALUE 'rework' BEFORE 'edit';--> statement-breakpoint
ALTER TYPE "relation_type" ADD VALUE 'cover';--> statement-breakpoint
ALTER TYPE "relation_type" ADD VALUE 'instrumental';--> statement-breakpoint
ALTER TYPE "relation_type" ADD VALUE 'acoustic';--> statement-breakpoint
ALTER TABLE "track_relatons"
    RENAME TO "track_relations";--> statement-breakpoint
ALTER TABLE "track_relations"
    DROP CONSTRAINT "track_relatons_pkey";--> statement-breakpoint
ALTER TABLE "track_relations"
    ADD PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_relation_unique" ON "track_relations" ("from_track_id", "to_track_id", "relation");