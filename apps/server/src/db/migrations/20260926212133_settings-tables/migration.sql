CREATE TYPE "settings_audit_scope" AS ENUM('project', 'instance');--> statement-breakpoint
CREATE TABLE "instance_setting_values" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "project_settings" (
	"project_id" integer,
	"key" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	CONSTRAINT "project_settings_pkey" PRIMARY KEY("project_id","key")
);
--> statement-breakpoint
CREATE TABLE "settings_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "settings_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" "settings_audit_scope" NOT NULL,
	"scope_id" text,
	"key" text NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"locked_before" boolean NOT NULL,
	"locked_after" boolean NOT NULL,
	"actor_id" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text,
	"key" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE INDEX "settings_audit_scope_id" ON "settings_audit" ("scope","scope_id","id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "instance_setting_values" ADD CONSTRAINT "instance_setting_values_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "settings_audit" ADD CONSTRAINT "settings_audit_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;