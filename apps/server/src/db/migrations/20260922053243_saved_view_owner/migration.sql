-- A saved view belongs to the member who saved it, and no existing row records
-- who that was. They are removed before the owner column stops accepting NULL
-- rather than handed to someone who never made them.
DELETE FROM "saved_views";--> statement-breakpoint
DROP INDEX "saved_views_project_kind_name";--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_project_kind_owner_name" ON "saved_views" ("project_id","kind","owner_id","name");--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;