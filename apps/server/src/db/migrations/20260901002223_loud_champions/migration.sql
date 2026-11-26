ALTER TABLE "statuses"
    DROP CONSTRAINT "statuses_name_key";--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_project_name" ON "statuses" ("project_id", "name") WHERE ("project_id" is not null);--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_global_name" ON "statuses" ("name") WHERE ("project_id" is null);