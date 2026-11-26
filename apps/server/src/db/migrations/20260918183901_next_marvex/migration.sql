CREATE TYPE "instance_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "registration" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"registration" "registration" DEFAULT 'open'::"registration" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "instance_settings_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "instance_role" "instance_role" DEFAULT 'user'::"instance_role" NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
-- An instance that already has accounts never ran the first-user bootstrap, so
-- it would otherwise have no admin at all. The oldest non-anonymous account is
-- the one whoever set the instance up holds, and it is the account the interim
-- `/admin/*` gate already treated as the administrator, so it keeps the role it
-- had in practice. Idempotent: it does nothing once any admin exists.
UPDATE "users" SET "instance_role" = 'admin'
 WHERE "id" = (
   SELECT "id" FROM "users"
    WHERE "is_anonymous" IS NOT TRUE
    ORDER BY "created_at", "id"
    LIMIT 1
 )
   AND NOT EXISTS (SELECT 1 FROM "users" WHERE "instance_role" = 'admin');--> statement-breakpoint
-- Registration is open only while nobody has signed up: on an instance that
-- already has accounts, the bootstrap that would have closed it never ran, and
-- leaving it open would hand a stranger an account on somebody's private
-- instance. An invited address is admitted either way.
INSERT INTO "instance_settings" ("id", "registration")
VALUES (
  1,
  CASE
    WHEN EXISTS (SELECT 1 FROM "users" WHERE "is_anonymous" IS NOT TRUE)
      THEN 'closed'::"registration"
    ELSE 'open'::"registration"
  END
)
ON CONFLICT ("id") DO NOTHING;
