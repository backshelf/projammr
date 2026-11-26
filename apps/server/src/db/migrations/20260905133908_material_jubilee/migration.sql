ALTER TABLE "assets" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fingerprint" text;--> statement-breakpoint
CREATE INDEX "assets_project_fingerprint" ON "assets" ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "sessions_project_fingerprint" ON "sessions" ("project_id","fingerprint");