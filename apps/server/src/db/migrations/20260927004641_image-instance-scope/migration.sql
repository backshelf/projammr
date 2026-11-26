ALTER TYPE "image_scope" ADD VALUE 'instance';--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_scope_owner", ADD CONSTRAINT "images_scope_owner" CHECK (("scope" = 'project' AND "project_id" IS NOT NULL)
        OR ("scope" = 'user' AND "created_by_user" IS NOT NULL)
        OR ("scope"::text = 'instance' AND "project_id" IS NULL));