CREATE TABLE "device_settings" (
	"device_id" text,
	"key" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_settings_pkey" PRIMARY KEY("device_id","key")
);
--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "device_command_kind";--> statement-breakpoint
CREATE TYPE "device_command_kind" AS ENUM('scan-now', 'full-rescan', 'rename', 'sign-out');--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "kind" SET DATA TYPE "device_command_kind" USING "kind"::"device_command_kind";--> statement-breakpoint
ALTER TABLE "scanner_devices" DROP COLUMN "settings_version";--> statement-breakpoint
ALTER TABLE "device_settings" ADD CONSTRAINT "device_settings_device_id_scanner_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "scanner_devices"("id") ON DELETE CASCADE;