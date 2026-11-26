CREATE INDEX "save_hash" ON "saves" ("hash") WHERE "hash" is not null;--> statement-breakpoint
-- Delete orphaned instance-limits.minScannerVersion rows left behind after scanner removal.
DELETE FROM "instance_setting_values" WHERE "key" = 'instance-limits.minScannerVersion';--> statement-breakpoint
DELETE FROM "settings_audit" WHERE "key" = 'instance-limits.minScannerVersion';
