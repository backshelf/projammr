-- Custom SQL migration file, put your code below! --

-- The two settings stores that predate the per-scope settings tables move into
-- rows before the next migration drops them.
--
-- `users.prefs`: each lyrics prefix a user's stored preferences hold becomes
-- that user's own `editor.*` row. A prefix they never set stays without a row,
-- so it inherits like any other unset key; a stored value that is not a string
-- was never a prefix and is left behind. The old write stored the whole object,
-- defaults filled in, whichever prefix was saved, so a value equal to the old
-- default (`\` rhyme, `~` synonym) is read as never set: a row for it would pin
-- the user to it over any member default the instance later sets.
INSERT INTO "user_settings" ("user_id", "key", "value", "updated_at")
SELECT "id", 'editor.rhymePrefix', "prefs" -> 'prefixes' -> 'rhyme', now()
FROM "users"
WHERE jsonb_typeof("prefs" -> 'prefixes' -> 'rhyme') = 'string'
  AND "prefs" -> 'prefixes' ->> 'rhyme' <> '\'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_settings" ("user_id", "key", "value", "updated_at")
SELECT "id", 'editor.synonymPrefix', "prefs" -> 'prefixes' -> 'synonym', now()
FROM "users"
WHERE jsonb_typeof("prefs" -> 'prefixes' -> 'synonym') = 'string'
  AND "prefs" -> 'prefixes' ->> 'synonym' <> '~'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- `instance_settings`: its one row's registration mode becomes the instance's
-- `instance-access.registration` row, keeping who wrote it and when. An
-- instance with no row has never had one written, and reads the default.
INSERT INTO "instance_setting_values" ("key", "value", "locked", "updated_by", "updated_at")
SELECT 'instance-access.registration', to_jsonb("registration"::text), false, "updated_by", "updated_at"
FROM "instance_settings"
ON CONFLICT DO NOTHING;
