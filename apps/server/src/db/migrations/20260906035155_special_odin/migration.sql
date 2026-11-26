CREATE TYPE "image_scope" AS ENUM('project', 'user');--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "scope" "image_scope" DEFAULT 'project'::"image_scope" NOT NULL;