-- Every track lyrics/notes edit predating the encrypted notebook wrote its
-- plaintext into `activity.changes` under a `lyrics` key; the client only
-- hid the field. Now that tracks carry no `lyrics` column at all, the key is
-- stale on every row that has it and would surface old lyric text the
-- moment `lyrics` comes out of `ActivityFeed.HIDDEN_FIELDS`.
UPDATE "activity"
SET "changes" = "changes" - 'lyrics'
WHERE "changes" ? 'lyrics';
