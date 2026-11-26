-- The scanner's settings groups and keybindings.catalogue are gone from the registry: their rows are orphans.
DELETE FROM "user_settings" WHERE "key" LIKE 'scanner-%' OR "key" = 'keybindings.catalogue';--> statement-breakpoint
DELETE FROM "project_settings" WHERE "key" LIKE 'scanner-%' OR "key" = 'keybindings.catalogue';--> statement-breakpoint
DELETE FROM "instance_setting_values" WHERE "key" LIKE 'scanner-%' OR "key" = 'keybindings.catalogue';--> statement-breakpoint
DELETE FROM "settings_audit" WHERE "key" LIKE 'scanner-%' OR "key" = 'keybindings.catalogue';--> statement-breakpoint
-- The "Ask before deleting" kind `device` is now `machine`.
UPDATE "user_settings" SET "value" = ("value" - 'device') || jsonb_build_object('machine', "value" -> 'device') WHERE "key" = 'feedback.confirmDeletes' AND "value" ? 'device';--> statement-breakpoint
UPDATE "instance_setting_values" SET "value" = ("value" - 'device') || jsonb_build_object('machine', "value" -> 'device') WHERE "key" = 'feedback.confirmDeletes' AND "value" ? 'device';
