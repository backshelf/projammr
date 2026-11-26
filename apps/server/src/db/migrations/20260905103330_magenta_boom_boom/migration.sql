ALTER TYPE "activity_action" ADD VALUE 'commented';--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "comment_id" integer;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;