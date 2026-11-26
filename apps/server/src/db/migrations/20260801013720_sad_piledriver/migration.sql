ALTER TABLE "collections" DROP CONSTRAINT "collections_image_id_images_id_fkey";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_image_id_images_id_fkey";--> statement-breakpoint
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_image_id_images_id_fkey";--> statement-breakpoint
DROP INDEX "one_profile_picture";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "image_id";--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "is_profile_picture";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "image_id";--> statement-breakpoint
ALTER TABLE "tracks" DROP COLUMN "image_id";--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_created_by_user_users_id_fkey", ADD CONSTRAINT "images_created_by_user_users_id_fkey" FOREIGN KEY ("created_by_user") REFERENCES "users"("id") ON DELETE SET NULL;