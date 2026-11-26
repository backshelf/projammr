DROP INDEX "one_main";--> statement-breakpoint
CREATE UNIQUE INDEX "one_main" ON "sessions" ("main", "track_id") WHERE (("main" = true) and (("track_id" is not null)));