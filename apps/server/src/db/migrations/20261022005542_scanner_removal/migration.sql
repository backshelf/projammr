ALTER TABLE "device_settings" DROP CONSTRAINT "device_settings_device_id_scanner_devices_id_fkey";--> statement-breakpoint
ALTER TABLE "device_backups" DROP CONSTRAINT "device_backups_device_id_scanner_devices_id_fkey";--> statement-breakpoint
ALTER TABLE "device_commands" DROP CONSTRAINT "device_commands_device_id_scanner_devices_id_fkey";--> statement-breakpoint
DROP TABLE "device_settings";--> statement-breakpoint
DROP TABLE "device_backups";--> statement-breakpoint
DROP TABLE "device_commands";--> statement-breakpoint
DROP TABLE "scanner_device_removals";--> statement-breakpoint
DROP TABLE "scanner_devices";--> statement-breakpoint
DROP TABLE "scanner_rejections";--> statement-breakpoint
DROP TYPE "device_command_kind";--> statement-breakpoint
DROP TYPE "scanner_device_status";--> statement-breakpoint
DROP TYPE "scanner_rejection_kind";