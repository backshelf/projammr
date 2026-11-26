CREATE TYPE "member_role" AS ENUM ('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
ALTER TABLE "members"
    ALTER COLUMN "role" SET DATA TYPE "member_role" USING "role"::"member_role";--> statement-breakpoint
ALTER TABLE "members"
    ALTER COLUMN "role" SET DEFAULT 'viewer'::"member_role";--> statement-breakpoint
ALTER TABLE "members"
    ADD CONSTRAINT "member_user_project" UNIQUE ("user_id", "project_id");