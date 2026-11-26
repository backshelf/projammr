CREATE TYPE "admin_audit_action" AS ENUM('reset_link_issued', 'role_changed', 'account_disabled', 'account_enabled', 'account_self_deleted');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"action" "admin_audit_action" NOT NULL,
	"actor_id" text,
	"actor_email" text NOT NULL,
	"actor_name" text NOT NULL,
	"target_user_id" text,
	"target_email" text NOT NULL,
	"target_name" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_target_user_id_users_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL;