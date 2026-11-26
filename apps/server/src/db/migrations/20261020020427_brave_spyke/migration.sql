CREATE TABLE "save_sample_objects" (
	"save_id" integer,
	"object_hash" text,
	CONSTRAINT "save_sample_objects_pkey" PRIMARY KEY("save_id","object_hash")
);
--> statement-breakpoint
CREATE INDEX "save_sample_object_hash" ON "save_sample_objects" ("object_hash");--> statement-breakpoint
ALTER TABLE "save_sample_objects" ADD CONSTRAINT "save_sample_objects_save_id_saves_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "save_sample_objects" ADD CONSTRAINT "save_sample_objects_object_hash_objects_hash_fkey" FOREIGN KEY ("object_hash") REFERENCES "objects"("hash") ON DELETE RESTRICT;