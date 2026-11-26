DROP INDEX "repo_object_hash";--> statement-breakpoint
CREATE INDEX "repo_object_hash" ON "repo_objects" ("object_hash","pushed_at","repo_id");