CREATE TYPE "device_command_kind" AS ENUM('scan-now', 'full-rescan', 'apply-settings', 'rename', 'sign-out');--> statement-breakpoint
CREATE TYPE "scanner_device_status" AS ENUM('idle', 'scanning', 'paused-on-battery', 'no-project');--> statement-breakpoint
CREATE TYPE "scanner_rejection_kind" AS ENUM('not-a-render', 'wrong-song');--> statement-breakpoint
CREATE TABLE "device_backups" (
	"device_id" text PRIMARY KEY,
	"config" jsonb NOT NULL,
	"paths" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_commands" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "device_commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"device_id" text NOT NULL,
	"kind" "device_command_kind" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"completed_at" timestamp,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "scanner_device_removals" (
	"device_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"removed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scanner_devices" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" varchar(64) NOT NULL,
	"platform" varchar(64) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"project_id" integer,
	"status" "scanner_device_status" NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"last_scan_at" timestamp,
	"last_scan_summary" jsonb,
	"settings_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scanner_rejections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scanner_rejections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"project_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" "scanner_rejection_kind" NOT NULL,
	"track_id" integer,
	"file_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scanner_rejections_key" UNIQUE NULLS NOT DISTINCT("user_id","project_id","fingerprint","kind","track_id"),
	CONSTRAINT "scanner_rejections_track_by_kind" CHECK (("kind" = 'wrong-song') = ("track_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "device_commands_device" ON "device_commands" ("device_id");--> statement-breakpoint
CREATE INDEX "scanner_device_removals_user" ON "scanner_device_removals" ("user_id");--> statement-breakpoint
CREATE INDEX "scanner_devices_user" ON "scanner_devices" ("user_id");--> statement-breakpoint
CREATE INDEX "scanner_devices_project" ON "scanner_devices" ("project_id");--> statement-breakpoint
CREATE INDEX "scanner_rejections_project" ON "scanner_rejections" ("project_id");--> statement-breakpoint
CREATE INDEX "scanner_rejections_track" ON "scanner_rejections" ("track_id");--> statement-breakpoint
ALTER TABLE "device_backups" ADD CONSTRAINT "device_backups_device_id_scanner_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "scanner_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_scanner_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "scanner_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scanner_device_removals" ADD CONSTRAINT "scanner_device_removals_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scanner_devices" ADD CONSTRAINT "scanner_devices_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scanner_devices" ADD CONSTRAINT "scanner_devices_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scanner_rejections" ADD CONSTRAINT "scanner_rejections_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scanner_rejections" ADD CONSTRAINT "scanner_rejections_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scanner_rejections" ADD CONSTRAINT "scanner_rejections_track_id_tracks_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE;