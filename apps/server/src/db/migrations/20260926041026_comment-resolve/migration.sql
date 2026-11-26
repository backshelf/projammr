ALTER TABLE "comments" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_users_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;