DROP INDEX "track_relation_unique";--> statement-breakpoint
ALTER TABLE "track_relations" DROP COLUMN "relation";--> statement-breakpoint
ALTER TABLE "track_relations" ALTER COLUMN "relation_type_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "track_relation_unique" ON "track_relations" ("from_track_id","to_track_id","relation_type_id");--> statement-breakpoint
DROP TYPE "relation_type";